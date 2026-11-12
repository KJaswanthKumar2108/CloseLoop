import { z } from 'zod';

/**
 * Strict runtime schema for PayPal currency amount objects.
 */
export const paypalCurrencyAmountSchema = z.object({
  currency_code: z
    .string()
    .min(3, 'Currency code must be at least 3 characters')
    .max(3, 'Currency code must be exactly 3 characters')
    .toUpperCase(),
  value: z
    .string()
    .min(1, 'Amount value string cannot be empty')
    .regex(/^-?\d+(\.\d+)?$/, 'Amount value must be a valid numeric decimal string'),
});

export type PayPalCurrencyAmount = z.infer<typeof paypalCurrencyAmountSchema>;

/**
 * Strict runtime schema for transaction_info object within PayPal Reporting API items.
 */
export const paypalTransactionInfoSchema = z.object({
  transaction_id: z.string().min(1, 'transaction_id is required'),
  paypal_account_id: z.string().optional(),
  paypal_reference_id: z.string().optional(),
  paypal_reference_id_type: z.string().optional(),
  transaction_event_code: z.string().optional(),
  transaction_initiation_date: z.string().optional(),
  transaction_updated_date: z.string().optional(),
  transaction_amount: paypalCurrencyAmountSchema,
  fee_amount: paypalCurrencyAmountSchema.optional(),
  net_amount: paypalCurrencyAmountSchema.optional(),
  transaction_status: z.string().optional(),
  transaction_subject: z.string().optional(),
  invoice_id: z.string().optional(),
  custom_field: z.string().optional(),
});

export type PayPalTransactionInfo = z.infer<typeof paypalTransactionInfoSchema>;

/**
 * Payer info schema (optional payer metadata).
 */
export const paypalPayerInfoSchema = z.object({
  account_id: z.string().optional(),
  email_address: z.string().optional(),
  payer_name: z
    .object({
      given_name: z.string().optional(),
      surname: z.string().optional(),
      alternate_full_name: z.string().optional(),
    })
    .optional(),
});

export type PayPalPayerInfo = z.infer<typeof paypalPayerInfoSchema>;

/**
 * Schema for an individual transaction_detail element in the PayPal response array.
 */
export const paypalTransactionDetailSchema = z.object({
  transaction_info: paypalTransactionInfoSchema,
  payer_info: paypalPayerInfoSchema.optional(),
  cart_info: z.record(z.string(), z.unknown()).optional(),
});

export type PayPalTransactionDetail = z.infer<typeof paypalTransactionDetailSchema>;

/**
 * Schema for the root response payload from GET /v1/reporting/transactions.
 */
export const paypalTransactionSearchResponseSchema = z.object({
  total_items: z.number().int().nonnegative().optional(),
  total_pages: z.number().int().nonnegative().optional(),
  page: z.number().int().positive().optional(),
  transaction_details: z.array(paypalTransactionDetailSchema).default([]),
});

export type PayPalTransactionSearchResponse = z.infer<
  typeof paypalTransactionSearchResponseSchema
>;

