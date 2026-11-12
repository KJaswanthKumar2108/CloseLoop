import { Money } from './financial';

export interface PayPalTransactionInfo {
  transactionId: string;
  paypalAccountId?: string;
  transactionEventCode: string;
  transactionInitiationDate: string;
  transactionUpdatedDate: string;
  transactionAmount: Money;
  feeAmount?: Money;
  netAmount?: Money;
  transactionStatus: 'S' | 'D' | 'P' | 'V'; // Success, Denied, Pending, Reversed
  payerInfo?: {
    accountId?: string;
    emailAddressMasked?: string;
    payerNameMasked?: string;
  };
  cartInfo?: {
    itemDetails?: Array<{
      itemName: string;
      itemQuantity: number;
      itemAmount: Money;
    }>;
  };
}

export interface PayPalSyncStatus {
  lastSyncTimestamp?: string;
  syncInProgress: boolean;
  transactionsIngested: number;
  environment: 'sandbox' | 'production';
  error?: string;
}

