/**
 * CloseLoop Phase 4: Deterministic Demonstration Fixtures (DEMO DATA)
 * Provides isolated, repeatable demonstration datasets for hackathon evaluation.
 *
 * Strict Isolation: Every record is explicitly tagged 'DEMO DATA'.
 * Demo data is strictly isolated from production and real imported PayPal ledgers.
 */

export interface DemoScenario {
  id: string;
  scenarioNumber: 1 | 2 | 3;
  title: string;
  tagline: string;
  discrepancyType: string;
  narrative: string;
  orderReference: string;
  expectedAmount: string;
  actualAmount: string;
  variance: string;
  expectedOutcome: string;
  recommendedActionId: string;
  uncertaintyScore: number;
  uncertaintyLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
  steps: Array<{
    stepNumber: number;
    title: string;
    description: string;
    component: string;
    badge: string;
  }>;
  demoOrderRecord: {
    orderId: string;
    amount: number;
    currency: string;
    customerEmail: string;
    status: string;
    date: string;
  };
  demoPaypalTransactions: Array<{
    transactionId: string;
    amount: number;
    fee: number;
    net: number;
    currency: string;
    status: string;
    date: string;
    customField?: string;
  }>;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'scenario_1_amount_variance',
    scenarioNumber: 1,
    title: 'Scenario 1: Amount Variance & Fee Schedule Discrepancy',
    tagline: 'Order $100.00 vs PayPal Capture $85.00 ($15.00 Variance)',
    discrepancyType: 'AMOUNT_MISMATCH',
    narrative:
      'Merchant OMS records a completed order for $100.00, but the PayPal capture arrived at $85.00. The reconciliation engine identifies a $15.00 gross difference. Evidence-grounded investigation identifies fee tier allocation divergence, recommends INVESTIGATE_AMOUNT_VARIANCE, secures human approval, and performs a controlled dry-run simulation.',
    orderReference: 'DEMO-ORD-101',
    expectedAmount: '$100.00 USD',
    actualAmount: '$85.00 USD',
    variance: '$15.00 USD',
    expectedOutcome:
      'Operator verifies root cause, approves fee adjustment voucher, and executes simulated ledger posting with zero external PayPal mutation.',
    recommendedActionId: 'INVESTIGATE_AMOUNT_VARIANCE',
    uncertaintyScore: 18,
    uncertaintyLevel: 'LOW',
    steps: [
      {
        stepNumber: 1,
        title: '1. Ingest & Detect',
        description:
          'Deterministic reconciliation matches DEMO-ORD-101 to PayPal capture TXN-PP-101-A, detects $15.00 variance, and extracts an immutable exception case.',
        component: 'Reconciliation Engine (Phase 2A / 3C)',
        badge: 'AMOUNT_MISMATCH',
      },
      {
        stepNumber: 2,
        title: '2. Grounded Evidence Dossier',
        description:
          'Inspects tuple-level evidence items: OMS Order Record ($100.00) and PayPal Durable Ledger Record ($85.00 gross, $2.75 fee).',
        component: 'Evidence Graph (Phase 3D.1)',
        badge: 'FINGERPRINT VERIFIED',
      },
      {
        stepNumber: 3,
        title: '3. AI Investigation',
        description:
          'Gemini AI Copilot generates root cause explanation grounded exclusively in observed facts, citing PayPal transaction event code T0006.',
        component: 'AI Investigation Engine (Phase 3D.2)',
        badge: 'CONFIDENCE: HIGH',
      },
      {
        stepNumber: 4,
        title: '4. Deterministic Recommendation',
        description:
          'Action catalog evaluates preconditions and suggests INVESTIGATE_AMOUNT_VARIANCE with 18% uncertainty score.',
        component: 'Recommendation Engine (Phase 3D.3)',
        badge: 'PRIMARY RECOMMENDED',
      },
      {
        stepNumber: 5,
        title: '5. Human Approval & Cryptographic Binding',
        description:
          'Operator submits approval request. Parameters are canonicalized (RFC 8785) into a 64-character SHA-256 hash. Operator grants approval with audit logging.',
        component: 'Approval State Machine (Phase 3D.4)',
        badge: 'APPROVED — AWAITING CONTROLLED EXECUTION',
      },
      {
        stepNumber: 6,
        title: '6. Controlled Dry-Run Simulation',
        description:
          'Controlled execution engine simulates adjusting journal voucher debiting accounts receivable and crediting fee expense without external financial mutation.',
        component: 'Controlled Execution (Phase 3D.5)',
        badge: 'SIMULATED — NO FINANCIAL ACTION EXECUTED',
      },
    ],
    demoOrderRecord: {
      orderId: 'DEMO-ORD-101',
      amount: 100.0,
      currency: 'USD',
      customerEmail: 'customer101@example.com',
      status: 'COMPLETED',
      date: '2026-11-12T10:00:00Z',
    },
    demoPaypalTransactions: [
      {
        transactionId: 'DEMO-TXN-101-A',
        amount: 85.0,
        fee: 2.75,
        net: 82.25,
        currency: 'USD',
        status: 'COMPLETED',
        date: '2026-11-12T10:02:15Z',
        customField: 'DEMO-ORD-101',
      },
    ],
  },
  {
    id: 'scenario_2_duplicate_payment',
    scenarioNumber: 2,
    title: 'Scenario 2: Potential Duplicate Payment & Collision Conflict',
    tagline: 'Order $75.00 matched to TWO separate $75.00 Captures',
    discrepancyType: 'DUPLICATE_PAYMENT',
    narrative:
      'Merchant OMS records a single $75.00 purchase (DEMO-ORD-202). However, two distinct PayPal transaction captures of $75.00 each reference this order. The reconciliation engine identifies a collision conflict. The system directs the operator to review the duplicate rather than performing an unverified automatic refund.',
    orderReference: 'DEMO-ORD-202',
    expectedAmount: '$75.00 USD',
    actualAmount: '$150.00 USD (2 x $75.00)',
    variance: '+$75.00 USD Overcapture',
    expectedOutcome:
      'Operator verifies duplicate capture, initiates customer hold, and prevents automated duplicate refund without merchant confirmation.',
    recommendedActionId: 'REVIEW_DUPLICATE_PAYMENT',
    uncertaintyScore: 35,
    uncertaintyLevel: 'MODERATE',
    steps: [
      {
        stepNumber: 1,
        title: '1. Ingest & Collision Detection',
        description:
          'Reconciliation identifies multiple candidate transactions for order DEMO-ORD-202. Flags duplicate payment state.',
        component: 'Reconciliation Engine (Phase 2A / 3C)',
        badge: 'DUPLICATE_PAYMENT',
      },
      {
        stepNumber: 2,
        title: '2. Multi-Capture Evidence Graph',
        description:
          'Evidence graph links TXN-PP-202-A ($75.00 @ 11:15) and TXN-PP-202-B ($75.00 @ 11:16) with distinct transaction identifiers.',
        component: 'Evidence Graph (Phase 3D.1)',
        badge: '2 FACTUAL CITATIONS',
      },
      {
        stepNumber: 3,
        title: '3. AI Investigation & Defense',
        description:
          'AI explains duplicate double-click cart checkout pattern and cautions that auto-refunding may violate store cancellation policy.',
        component: 'AI Investigation Engine (Phase 3D.2)',
        badge: 'EXPLAINABLE AUDIT',
      },
      {
        stepNumber: 4,
        title: '4. Conservative Recommendation',
        description:
          'Engine proposes REVIEW_DUPLICATE_PAYMENT. Strictly suppresses automated refunding until operator reviews dispute history.',
        component: 'Recommendation Engine (Phase 3D.3)',
        badge: 'HIGH RISK — HUMAN REVIEW REQUIRED',
      },
      {
        stepNumber: 5,
        title: '5. Human Operator Gate',
        description:
          'Operator inspects customer account history and authorizes duplicate funds isolation hold.',
        component: 'Approval State Machine (Phase 3D.4)',
        badge: 'OPERATOR AUTHORIZED',
      },
      {
        stepNumber: 6,
        title: '6. Controlled Hold Simulation',
        description:
          'Dry run simulates temporary hold voucher isolating secondary capture from daily settlement.',
        component: 'Controlled Execution (Phase 3D.5)',
        badge: 'SIMULATED HOLD CREATED',
      },
    ],
    demoOrderRecord: {
      orderId: 'DEMO-ORD-202',
      amount: 75.0,
      currency: 'USD',
      customerEmail: 'shopper202@example.com',
      status: 'COMPLETED',
      date: '2026-11-12T11:15:00Z',
    },
    demoPaypalTransactions: [
      {
        transactionId: 'DEMO-TXN-202-A',
        amount: 75.0,
        fee: 2.45,
        net: 72.55,
        currency: 'USD',
        status: 'COMPLETED',
        date: '2026-11-12T11:15:30Z',
        customField: 'DEMO-ORD-202',
      },
      {
        transactionId: 'DEMO-TXN-202-B',
        amount: 75.0,
        fee: 2.45,
        net: 72.55,
        currency: 'USD',
        status: 'COMPLETED',
        date: '2026-11-12T11:16:10Z',
        customField: 'DEMO-ORD-202',
      },
    ],
  },
  {
    id: 'scenario_3_ambiguous_evidence',
    scenarioNumber: 3,
    title: 'Scenario 3: Ambiguous Evidence & Multi-Entity Uncertainty',
    tagline: 'Orphan Capture without Invoice ID ($150.00)',
    discrepancyType: 'MISSING_ORDER_IN_MERCHANT',
    narrative:
      'A PayPal transaction of $150.00 was imported without a merchant order ID or custom invoice reference. No single clear order match exists in the merchant database. Uncertainty increases to 72% (VERY_HIGH). Automated action is suppressed, and the case is escalated for manual controller review.',
    orderReference: 'DEMO-ORD-303 (Orphan)',
    expectedAmount: 'Unrecorded in OMS',
    actualAmount: '$150.00 USD',
    variance: '$150.00 Unmatched Capture',
    expectedOutcome:
      'High uncertainty scoring actively suppresses automated resolution; system escalates case for supervisory investigation.',
    recommendedActionId: 'ESCALATE_FOR_MANUAL_REVIEW',
    uncertaintyScore: 72,
    uncertaintyLevel: 'VERY_HIGH',
    steps: [
      {
        stepNumber: 1,
        title: '1. Ingest & Unmatched Classification',
        description:
          'Reconciliation flags orphan PayPal transaction DEMO-TXN-303-ORPHAN with zero matching OMS order identifiers.',
        component: 'Reconciliation Engine (Phase 2A / 3C)',
        badge: 'UNMATCHED_TRANSACTION',
      },
      {
        stepNumber: 2,
        title: '2. Incomplete Evidence Dossier',
        description:
          'Evidence graph identifies missing order receipt and unpopulated buyer email in ledger snapshot.',
        component: 'Evidence Graph (Phase 3D.1)',
        badge: 'INCOMPLETE METADATA',
      },
      {
        stepNumber: 3,
        title: '3. Grounding Verification & Defense',
        description:
          'AI Copilot reports low confidence due to absence of relational order tuples. Refuses to hallucinate customer identity.',
        component: 'AI Safety & Grounding (Phase 3D.2)',
        badge: 'ANTI-HALLUCINATION SHIELD',
      },
      {
        stepNumber: 4,
        title: '4. Uncertainty Scoring & Suppression',
        description:
          'Uncertainty score hits 72% (+25 missing order, +25 unpopulated invoice, +22 reference ambiguity). Automated action is suppressed.',
        component: 'Uncertainty Scorer (Phase 3D.3)',
        badge: 'ACTION SUPPRESSED (72% UNCERTAINTY)',
      },
      {
        stepNumber: 5,
        title: '5. Supervisory Escalation',
        description:
          'Recommendation engine selects ESCALATE_FOR_MANUAL_REVIEW as the only safe policy-compliant action.',
        component: 'Catalog Policy Governance (Phase 3D.3)',
        badge: 'SUPERVISOR ESCALATION',
      },
      {
        stepNumber: 6,
        title: '6. Controlled Dossier Generation',
        description:
          'Dry run creates an audit-ready supervisory dossier for financial controller sign-off.',
        component: 'Controlled Execution (Phase 3D.5)',
        badge: 'SUPERVISORY DOSSIER CREATED',
      },
    ],
    demoOrderRecord: {
      orderId: 'DEMO-ORD-303',
      amount: 0.0,
      currency: 'USD',
      customerEmail: 'unknown@unmatched.local',
      status: 'MISSING',
      date: '2026-11-12T12:00:00Z',
    },
    demoPaypalTransactions: [
      {
        transactionId: 'DEMO-TXN-303-ORPHAN',
        amount: 150.0,
        fee: 4.65,
        net: 145.35,
        currency: 'USD',
        status: 'COMPLETED',
        date: '2026-11-12T12:01:45Z',
      },
    ],
  },
];

