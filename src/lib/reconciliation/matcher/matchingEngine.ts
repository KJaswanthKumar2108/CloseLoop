import {
  MerchantOrder,
  PaymentTransaction,
  ReconciliationRecord,
  DiscrepancyType,
  ComparedField,
} from '@/types/financial';
import { zeroMoney, subtractMoney } from '../money';
import {
  MatchingConfiguration,
  DEFAULT_MATCHING_CONFIG,
  hasIdentityCorroboration,
} from './matchingRules';
import { evaluateAuthoritativeIdentifierMatch } from './exactMatcher';
import { createCompositeReconciliationRecord } from './compositeMatcher';
import {
  evaluateMultiCaptureMatch,
  calculateCandidateScore,
} from './candidateMatcher';
import { buildMatchingEvidence } from './matchingEvidence';

export interface MatchingEngineResult {
  records: ReconciliationRecord[];
  matchedOrdersCount: number;
  unmatchedOrdersCount: number;
  unmatchedTransactionsCount: number;
  exceptionCount: number;
}

interface CompositeCandidateEdge {
  order: MerchantOrder;
  transaction: PaymentTransaction;
  diffSeconds: number;
  hasCustomerMatch: boolean;
  hasCorroboration: boolean;
}

/**
 * Computes a deterministic Maximum Cardinality Bipartite Matching using augmenting paths (Kuhn's algorithm).
 *
 * Graph formulation:
 * - Left side (U): Unmatched eligible orders sorted canonically.
 * - Right side (V): Unconsumed eligible transactions.
 * - Edges (E): Eligible composite candidates with verified identity corroboration.
 *
 * Algorithm & Complexity:
 * - Implements Kuhn's augmenting path algorithm (Berge's Lemma).
 * - Finds augmenting paths via Depth-First Search over alternating paths.
 * - By Berge's Lemma, a matching has maximum cardinality if and only if no augmenting path exists.
 * - Time complexity: O(V * E). Since edges only exist within identical (currency, amountMinor)
 *   components, the graph decomposes into small independent bipartite subgraphs, executing in < 5ms.
 *
 * Deterministic Tie-Breaking:
 * - Candidate edges for each order are pre-sorted by:
 *   1. Direct customer reference match (true first).
 *   2. Minimal timestamp variance (diffSeconds ascending).
 *   3. Canonical transaction identifier (paypalTransactionId ascending).
 * - Augmenting path search explores candidate edges in this exact preference order.
 */
function computeMaximumCardinalityMatching(
  orderIds: string[],
  edgesByOrder: Map<string, CompositeCandidateEdge[]>
): Map<string, CompositeCandidateEdge> {
  const matchTxnToOrder = new Map<string, string>();
  const matchOrderToEdge = new Map<string, CompositeCandidateEdge>();

  function findAugmentingPath(
    orderId: string,
    visitedTxns: Set<string>
  ): boolean {
    const candidateEdges = edgesByOrder.get(orderId) || [];
    for (const edge of candidateEdges) {
      const txnId = edge.transaction.paypalTransactionId;
      if (visitedTxns.has(txnId)) continue;
      visitedTxns.add(txnId);

      const currentMatchedOrder = matchTxnToOrder.get(txnId);
      if (
        !currentMatchedOrder ||
        findAugmentingPath(currentMatchedOrder, visitedTxns)
      ) {
        matchTxnToOrder.set(txnId, orderId);
        matchOrderToEdge.set(orderId, edge);
        return true;
      }
    }
    return false;
  }

  // Iterate over orders in canonical order
  for (const orderId of orderIds) {
    const visitedTxns = new Set<string>();
    findAugmentingPath(orderId, visitedTxns);
  }

  return matchOrderToEdge;
}

/**
 * Top-Level Deterministic Reconciliation Engine.
 * Executes a deterministic, multi-pass matching strategy with zero LLM dependence.
 *
 * Guarantees:
 * - Permutation Invariance: Array input ordering never affects the matching outcome.
 * - Global Deterministic Assignment: Candidate pairs evaluated globally across the batch.
 * - Single Consumption: Every physical transaction is represented in at most one reconciliation record.
 * - Documented Ambiguity Policy: Temporal separation within ambiguityToleranceSeconds without
 *   distinguishing reference evidence triggers manual review.
 * - Exact Minor-Unit Math: All balances computed without floating-point arithmetic.
 */
export function runDeterministicMatching(
  orders: MerchantOrder[],
  transactions: PaymentTransaction[],
  userConfig: Partial<MatchingConfiguration> = {}
): MatchingEngineResult {
  const config: MatchingConfiguration = {
    ...DEFAULT_MATCHING_CONFIG,
    ...userConfig,
  };
  const records: ReconciliationRecord[] = [];

  const consumedOrderIds = new Set<string>();
  const consumedTransactionIds = new Set<string>();

  // --------------------------------------------------------------------------
  // CANONICAL PRE-SORTING: Ensures Strict Permutation Invariance
  // --------------------------------------------------------------------------
  const sortedOrders = [...orders].sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.merchantOrderId.localeCompare(b.merchantOrderId);
  });

  const sortedTransactions = [...transactions].sort((a, b) => {
    const timeA = new Date(a.transactionTime).getTime();
    const timeB = new Date(b.transactionTime).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.paypalTransactionId.localeCompare(b.paypalTransactionId);
  });

  // --------------------------------------------------------------------------
  // PRE-PASS: Multi-Capture Order Evaluation
  // --------------------------------------------------------------------------
  if (config.allowMultiCapture) {
    for (const order of sortedOrders) {
      if (consumedOrderIds.has(order.merchantOrderId)) continue;

      const availableTxns = sortedTransactions.filter(
        (t) => !consumedTransactionIds.has(t.paypalTransactionId)
      );

      const multiRecord = evaluateMultiCaptureMatch(order, availableTxns, config);

      if (multiRecord) {
        records.push(multiRecord);
        consumedOrderIds.add(order.merchantOrderId);
        for (const tid of multiRecord.transactionIds) {
          consumedTransactionIds.add(tid);
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // PASS 1: Authoritative Identifier Matching
  // --------------------------------------------------------------------------
  for (const order of sortedOrders) {
    if (consumedOrderIds.has(order.merchantOrderId)) continue;

    const candidateMatches = [];
    for (const txn of sortedTransactions) {
      if (consumedTransactionIds.has(txn.paypalTransactionId)) continue;

      const matchResult = evaluateAuthoritativeIdentifierMatch(order, txn);
      if (matchResult) {
        candidateMatches.push(matchResult);
      }
    }

    if (candidateMatches.length > 0) {
      // Prioritize completed capture MATCHED over TIMING_DELAY / AUTHORIZATION hold
      candidateMatches.sort((a, b) => {
        if (a.matchedRecord.matchStatus === 'MATCHED' && b.matchedRecord.matchStatus !== 'MATCHED') return -1;
        if (b.matchedRecord.matchStatus === 'MATCHED' && a.matchedRecord.matchStatus !== 'MATCHED') return 1;
        return 0;
      });

      const bestMatch = candidateMatches[0];
      records.push(bestMatch.matchedRecord);
      consumedOrderIds.add(order.merchantOrderId);
      consumedTransactionIds.add(bestMatch.matchedTransaction.paypalTransactionId);
    }
  }

  // --------------------------------------------------------------------------
  // PASS 2: Global Deterministic Composite Matching
  // --------------------------------------------------------------------------
  // 1. Gather all unconsumed orders and transactions
  const unconsumedOrders = sortedOrders.filter((o) => !consumedOrderIds.has(o.merchantOrderId));
  const unconsumedTransactions = sortedTransactions.filter(
    (t) => !consumedTransactionIds.has(t.paypalTransactionId)
  );

  // 2. Build all eligible candidate edges across the entire batch
  const allEdges: CompositeCandidateEdge[] = [];
  const edgesByOrder = new Map<string, CompositeCandidateEdge[]>();
  const edgesByTransaction = new Map<string, CompositeCandidateEdge[]>();

  for (const order of unconsumedOrders) {
    const orderTime = new Date(order.createdAt).getTime();

    for (const txn of unconsumedTransactions) {
      // Must be identical currency
      if (config.strictCurrencyMatching && order.currency !== txn.currency) continue;

      // Must be identical minor-unit gross amount
      if (order.expectedAmount.amountMinor !== txn.grossAmount.amountMinor) continue;

      // Must be a completed capture (authorizations and non-captures strictly excluded)
      if (txn.transactionType !== 'CAPTURE' || txn.transactionStatus !== 'COMPLETED') continue;

      // Timestamp proximity check
      const txnTime = new Date(txn.transactionTime).getTime();
      const diffSeconds = Math.abs(Math.round((txnTime - orderTime) / 1000));
      if (diffSeconds > config.timestampToleranceSeconds) continue;

      const hasCorroboration = hasIdentityCorroboration(order, txn);
      let hasCustomerMatch = false;
      if (order.customerReference && txn.merchantReference) {
        hasCustomerMatch =
          order.customerReference.toLowerCase().trim() ===
          txn.merchantReference.toLowerCase().trim();
      }

      const edge: CompositeCandidateEdge = {
        order,
        transaction: txn,
        diffSeconds,
        hasCustomerMatch,
        hasCorroboration,
      };

      allEdges.push(edge);

      if (!edgesByOrder.has(order.merchantOrderId)) {
        edgesByOrder.set(order.merchantOrderId, []);
      }
      edgesByOrder.get(order.merchantOrderId)!.push(edge);

      if (!edgesByTransaction.has(txn.paypalTransactionId)) {
        edgesByTransaction.set(txn.paypalTransactionId, []);
      }
      edgesByTransaction.get(txn.paypalTransactionId)!.push(edge);
    }
  }

  // 3. Ambiguity Evaluation via Documented Ambiguity Separation Policy
  const ambiguousOrderIds = new Set<string>();
  const ambiguousTxnIds = new Set<string>();

  // Check for orders with competing indistinguishable transactions
  for (const [orderId, edges] of edgesByOrder.entries()) {
    if (edges.length >= 2) {
      edges.sort((a, b) => a.diffSeconds - b.diffSeconds);
      const e1 = edges[0];
      const e2 = edges[1];

      // If separated by less than ambiguityToleranceSeconds and reference evidence doesn't break tie:
      const timeSeparation = Math.abs(e2.diffSeconds - e1.diffSeconds);
      if (
        timeSeparation < config.ambiguityToleranceSeconds &&
        e1.hasCorroboration === e2.hasCorroboration &&
        e1.hasCustomerMatch === e2.hasCustomerMatch
      ) {
        ambiguousOrderIds.add(orderId);
        ambiguousTxnIds.add(e1.transaction.paypalTransactionId);
        ambiguousTxnIds.add(e2.transaction.paypalTransactionId);
      }
    }
  }

  // Check for transactions with competing indistinguishable orders
  for (const [txnId, edges] of edgesByTransaction.entries()) {
    if (edges.length >= 2) {
      edges.sort((a, b) => a.diffSeconds - b.diffSeconds);
      const e1 = edges[0];
      const e2 = edges[1];

      const timeSeparation = Math.abs(e2.diffSeconds - e1.diffSeconds);
      if (
        timeSeparation < config.ambiguityToleranceSeconds &&
        e1.hasCorroboration === e2.hasCorroboration &&
        e1.hasCustomerMatch === e2.hasCustomerMatch
      ) {
        ambiguousTxnIds.add(txnId);
        ambiguousOrderIds.add(e1.order.merchantOrderId);
        ambiguousOrderIds.add(e2.order.merchantOrderId);
      }
    }
  }

  // 4. Maximum-Cardinality Automatic Confirmed Allocation (Remediation C & B)
  // Build eligible adjacency map strictly for edges with verified identity corroboration
  const eligibleEdgesByOrder = new Map<string, CompositeCandidateEdge[]>();
  const eligibleOrderIds: string[] = [];

  for (const order of unconsumedOrders) {
    const oId = order.merchantOrderId;
    if (consumedOrderIds.has(oId) || ambiguousOrderIds.has(oId)) continue;

    const candidateEdges = (edgesByOrder.get(oId) || []).filter(
      (e) =>
        e.hasCorroboration &&
        !ambiguousTxnIds.has(e.transaction.paypalTransactionId) &&
        !consumedTransactionIds.has(e.transaction.paypalTransactionId)
    );

    if (candidateEdges.length > 0) {
      // Priority sort on candidate edges:
      // 1. Direct customer reference match (true first)
      // 2. Minimal timestamp variance (diffSeconds ascending)
      // 3. Stable canonical transaction ID tie-breaker
      candidateEdges.sort((a, b) => {
        if (a.hasCustomerMatch !== b.hasCustomerMatch) {
          return a.hasCustomerMatch ? -1 : 1;
        }
        if (a.diffSeconds !== b.diffSeconds) {
          return a.diffSeconds - b.diffSeconds;
        }
        return a.transaction.paypalTransactionId.localeCompare(
          b.transaction.paypalTransactionId
        );
      });

      eligibleEdgesByOrder.set(oId, candidateEdges);
      eligibleOrderIds.push(oId);
    }
  }

  // Compute deterministic Maximum Cardinality Matching using augmenting paths
  const matchedAssignments = computeMaximumCardinalityMatching(
    eligibleOrderIds,
    eligibleEdgesByOrder
  );

  // Commit automatic confirmed matches
  for (const [oId, edge] of matchedAssignments.entries()) {
    const tId = edge.transaction.paypalTransactionId;
    if (consumedOrderIds.has(oId) || consumedTransactionIds.has(tId)) continue;

    const competingCandidates = (edgesByOrder.get(oId) || [])
      .filter((e) => e.transaction.paypalTransactionId !== tId)
      .map((e) => e.transaction.paypalTransactionId);

    const record = createCompositeReconciliationRecord(
      edge.order,
      edge.transaction,
      config,
      competingCandidates
    );

    records.push(record);
    consumedOrderIds.add(oId);
    consumedTransactionIds.add(tId);
  }

  // 5. Handle ambiguous orders detected in Pass 2
  for (const oId of ambiguousOrderIds) {
    if (consumedOrderIds.has(oId)) continue;

    const order = sortedOrders.find((o) => o.merchantOrderId === oId)!;
    const competingEdges = edgesByOrder.get(oId) || [];
    const competingTxns = competingEdges.map((e) => e.transaction);

    const comparedFields: ComparedField[] = [
      {
        field: 'competingCandidatesCount',
        orderValue: '1 Order',
        transactionValue: `${competingTxns.length} Competing Transactions`,
        matched: false,
      },
    ];

    const evidence = buildMatchingEvidence({
      order,
      transactions: competingTxns,
      matchingMethod: 'COMPOSITE_HEURISTIC',
      matchingRule: 'RULE_CONFLICT_AMBIGUOUS_CANDIDATES',
      comparedFields,
      reasonsForAccepting: [
        `Ambiguity detected: Found ${competingTxns.length} competing transactions with identical amount within ${config.ambiguityToleranceSeconds}s threshold.`,
        'Candidates are materially indistinguishable without explicit reference metadata; routed to manual review.',
      ],
      toleranceWindowSeconds: config.timestampToleranceSeconds,
    });

    records.push({
      id: `rec_ambig_${order.merchantOrderId}`,
      orderId: order.merchantOrderId,
      transactionIds: competingTxns.map((t) => t.paypalTransactionId),
      matchStatus: 'AMBIGUOUS',
      discrepancyType: 'CONFLICTING_REFERENCES',
      confidence: 'MANUAL_REVIEW_REQUIRED',
      matchingMethod: 'COMPOSITE_HEURISTIC',
      expectedAmount: order.expectedAmount,
      actualAmount: competingTxns[0]?.grossAmount || zeroMoney(order.currency),
      varianceAmount: zeroMoney(order.currency),
      currency: order.currency,
      evidence,
      createdAt: new Date().toISOString(),
    });

    consumedOrderIds.add(oId);
    for (const t of competingTxns) {
      consumedTransactionIds.add(t.paypalTransactionId);
    }
  }

  // 6. Handle uncorroborated composite candidates (Remediation B)
  // An uncorroborated match based solely on amount, currency, and timestamp must NEVER
  // be automatically confirmed as MATCHED. Route to MANUAL_REVIEW_REQUIRED.
  for (const order of unconsumedOrders) {
    const oId = order.merchantOrderId;
    if (consumedOrderIds.has(oId)) continue;

    const uncorroboratedEdges = (edgesByOrder.get(oId) || []).filter(
      (e) => !consumedTransactionIds.has(e.transaction.paypalTransactionId)
    );

    if (uncorroboratedEdges.length > 0) {
      uncorroboratedEdges.sort((a, b) => a.diffSeconds - b.diffSeconds);
      const topEdge = uncorroboratedEdges[0];
      const allTxns = uncorroboratedEdges.map((e) => e.transaction);

      const comparedFields: ComparedField[] = [
        {
          field: 'grossAmount',
          orderValue: order.expectedAmount.amountMinor.toString(),
          transactionValue: topEdge.transaction.grossAmount.amountMinor.toString(),
          matched: true,
        },
        {
          field: 'currency',
          orderValue: order.currency,
          transactionValue: topEdge.transaction.currency,
          matched: true,
        },
        {
          field: 'identityCorroboration',
          orderValue: order.customerReference || order.externalReference || 'None',
          transactionValue: topEdge.transaction.merchantReference || topEdge.transaction.invoiceId || 'None',
          matched: false,
        },
      ];

      const evidence = buildMatchingEvidence({
        order,
        transactions: allTxns,
        matchingMethod: 'COMPOSITE_HEURISTIC',
        matchingRule: 'RULE_COMPOSITE_UNCORROBORATED_IDENTITY',
        comparedFields,
        reasonsForAccepting: [
          `Candidate matches on exact amount, currency, and timestamp proximity (${topEdge.diffSeconds}s delta).`,
          'Transaction lacks corroborating customer or order identity metadata; automatic confirmation prohibited. Routed to manual review.',
        ],
        toleranceWindowSeconds: config.timestampToleranceSeconds,
      });

      records.push({
        id: `rec_uncorroborated_${order.merchantOrderId}`,
        orderId: order.merchantOrderId,
        transactionIds: allTxns.map((t) => t.paypalTransactionId),
        matchStatus: 'AMBIGUOUS',
        discrepancyType: 'CONFLICTING_REFERENCES',
        confidence: 'MANUAL_REVIEW_REQUIRED',
        matchingMethod: 'COMPOSITE_HEURISTIC',
        expectedAmount: order.expectedAmount,
        actualAmount: topEdge.transaction.grossAmount,
        varianceAmount: zeroMoney(order.currency),
        currency: order.currency,
        evidence,
        createdAt: new Date().toISOString(),
      });

      consumedOrderIds.add(oId);
      for (const t of allTxns) {
        consumedTransactionIds.add(t.paypalTransactionId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // PASS 3: Candidate Scoring for Remaining Unconsumed Orders
  // --------------------------------------------------------------------------
  for (const order of sortedOrders) {
    if (consumedOrderIds.has(order.merchantOrderId)) continue;

    const availableTxns = sortedTransactions.filter(
      (t) => !consumedTransactionIds.has(t.paypalTransactionId)
    );

    const scoredCandidates = availableTxns
      .map((txn) => calculateCandidateScore(order, txn))
      .filter((c) => c.score >= config.candidateScoreThreshold)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.timeDifferenceSeconds - b.timeDifferenceSeconds;
      });

    if (scoredCandidates.length > 0) {
      const topCandidate = scoredCandidates[0];
      const evidence = buildMatchingEvidence({
        order,
        transactions: [topCandidate.transaction],
        matchingMethod: 'COMPOSITE_HEURISTIC',
        matchingRule: 'RULE_CANDIDATE_HEURISTIC_BELOW_AUTO_THRESHOLD',
        reasonsForAccepting: [
          `Potential candidate ${topCandidate.transaction.paypalTransactionId} scored ${topCandidate.score}/100.`,
          'Heuristic candidate requires human verification prior to confirmation.',
        ],
      });

      records.push({
        id: `rec_cand_${order.merchantOrderId}`,
        orderId: order.merchantOrderId,
        transactionIds: [topCandidate.transaction.paypalTransactionId],
        matchStatus: 'AMBIGUOUS',
        discrepancyType: 'AMOUNT_MISMATCH',
        confidence: 'LOW_CONFIDENCE_CANDIDATE',
        matchingMethod: 'COMPOSITE_HEURISTIC',
        expectedAmount: order.expectedAmount,
        actualAmount: topCandidate.transaction.grossAmount,
        varianceAmount:
          order.currency === topCandidate.transaction.currency
            ? subtractMoney(order.expectedAmount, topCandidate.transaction.grossAmount)
            : order.expectedAmount,
        currency: order.currency,
        evidence,
        createdAt: new Date().toISOString(),
      });

      consumedOrderIds.add(order.merchantOrderId);
      // CRITICAL (TASK 6): Consume transaction so it is not duplicated in Pass 5
      consumedTransactionIds.add(topCandidate.transaction.paypalTransactionId);
    }
  }

  // --------------------------------------------------------------------------
  // PASS 4: Unmatched Order Classification
  // --------------------------------------------------------------------------
  for (const order of sortedOrders) {
    if (consumedOrderIds.has(order.merchantOrderId)) continue;

    const evidence = buildMatchingEvidence({
      order,
      transactions: [],
      matchingMethod: 'UNMATCHED_DEFAULT',
      matchingRule: 'RULE_UNMATCHED_ORDER_NO_CORRESPONDING_TRANSACTION',
      reasonsForAccepting: [
        'No corresponding PayPal transaction found by identifier, composite parameters, or candidate scoring.',
      ],
    });

    records.push({
      id: `rec_unmatched_ord_${order.merchantOrderId}`,
      orderId: order.merchantOrderId,
      transactionIds: [],
      matchStatus: 'UNMATCHED_ORDER',
      discrepancyType: 'MISSING_PAYMENT',
      confidence: 'EXACT_AUTHORITATIVE',
      matchingMethod: 'UNMATCHED_DEFAULT',
      expectedAmount: order.expectedAmount,
      actualAmount: zeroMoney(order.currency),
      varianceAmount: order.expectedAmount,
      currency: order.currency,
      evidence,
      createdAt: new Date().toISOString(),
    });
    consumedOrderIds.add(order.merchantOrderId);
  }

  // --------------------------------------------------------------------------
  // PASS 5: Unmatched Transaction Classification (Zero Duplicates Policy)
  // --------------------------------------------------------------------------
  for (const txn of sortedTransactions) {
    if (consumedTransactionIds.has(txn.paypalTransactionId)) continue;

    let discrepancyType: DiscrepancyType = 'MISSING_METADATA';
    const reasons: string[] = [
      'No corresponding merchant order record found for this PayPal transaction.',
    ];

    if (txn.transactionType === 'AUTHORIZATION') {
      discrepancyType = 'TIMING_DELAY';
      reasons.push('Transaction is an uncaptured authorization hold.');
    } else if (txn.transactionType === 'REFUND' || txn.transactionType === 'REVERSAL') {
      discrepancyType = 'PARTIAL_REFUND_MISMATCH';
      reasons.push('Transaction is an unlinked refund or reversal.');
    } else if (txn.transactionType === 'DISPUTE_HOLD') {
      discrepancyType = 'DISPUTE_HOLD';
      reasons.push('Transaction is held under dispute.');
    }

    const evidence = buildMatchingEvidence({
      transactions: [txn],
      matchingMethod: 'UNMATCHED_DEFAULT',
      matchingRule: 'RULE_UNMATCHED_TRANSACTION_NO_CORRESPONDING_ORDER',
      reasonsForAccepting: reasons,
    });

    records.push({
      id: `rec_unmatched_txn_${txn.paypalTransactionId}`,
      transactionIds: [txn.paypalTransactionId],
      matchStatus: 'UNMATCHED_TRANSACTION',
      discrepancyType,
      confidence: 'EXACT_AUTHORITATIVE',
      matchingMethod: 'UNMATCHED_DEFAULT',
      expectedAmount: zeroMoney(txn.currency),
      actualAmount: txn.grossAmount,
      varianceAmount: txn.grossAmount,
      currency: txn.currency,
      evidence,
      createdAt: new Date().toISOString(),
    });
    consumedTransactionIds.add(txn.paypalTransactionId);
  }

  // Calculate summary metrics
  let matchedCount = 0;
  let unmatchedOrdersCount = 0;
  let unmatchedTransactionsCount = 0;
  let exceptionCount = 0;

  for (const r of records) {
    if (r.matchStatus === 'MATCHED') {
      matchedCount++;
    } else if (r.matchStatus === 'UNMATCHED_ORDER') {
      unmatchedOrdersCount++;
    } else if (r.matchStatus === 'UNMATCHED_TRANSACTION') {
      unmatchedTransactionsCount++;
    } else if (r.matchStatus === 'DISCREPANCY' || r.matchStatus === 'AMBIGUOUS') {
      exceptionCount++;
    }
  }

  return {
    records,
    matchedOrdersCount: matchedCount,
    unmatchedOrdersCount,
    unmatchedTransactionsCount,
    exceptionCount,
  };
}
