import { Money } from '@/types/financial';

/**
 * ISO 4217 Currency Precision Registry
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'JPY',
  'KRW',
  'CLP',
  'VND',
  'PYG',
  'UGX',
  'RWF',
  'BIF',
  'DJF',
  'GNF',
  'KMF',
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  'BHD',
  'KWD',
  'OMR',
  'JOD',
  'TND',
  'LYD',
  'IQD',
]);

/**
 * Look up official minor unit decimal precision for any currency code.
 */
export function getCurrencyPrecision(currency: string): number {
  const upper = currency.toUpperCase().trim();
  if (ZERO_DECIMAL_CURRENCIES.has(upper)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(upper)) return 3;
  return 2; // Default for USD, EUR, GBP, CAD, AUD, etc.
}

/**
 * Creates a validated Money object using integer minor units.
 * Rejects non-integers and numbers exceeding Number.MAX_SAFE_INTEGER.
 */
export function createMoney(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(
      `Financial amounts must be integers in minor units. Received non-integer: ${amountMinor}`
    );
  }

  if (Math.abs(amountMinor) > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Financial amount minor units exceed Number.MAX_SAFE_INTEGER: ${amountMinor}`
    );
  }

  const cleanCurrency = currency.toUpperCase().trim();
  if (!cleanCurrency || cleanCurrency.length !== 3) {
    throw new Error(`Invalid ISO 4217 currency code: "${currency}"`);
  }

  const precision = getCurrencyPrecision(cleanCurrency);

  return {
    amountMinor,
    currency: cleanCurrency,
    precision,
  };
}

/**
 * Zero money constant generator for a given currency.
 */
export function zeroMoney(currency: string): Money {
  return createMoney(0, currency);
}

/**
 * Parse a decimal string into a Money object using exact string manipulation.
 * Strict validation:
 * - Rejects malformed strings (e.g. "10..5", "--10", "abc")
 * - Rejects excess fractional digits beyond currency precision (e.g. "10.555" for USD)
 * - Rejects fractional digits for zero-decimal currencies (e.g. "500.5" for JPY)
 * - Rejects arithmetic overflow
 * - Preserves negative signs for refunds / reversals
 */
export function parseDecimalToMoney(decimalStr: string | number, currency: string): Money {
  const cleanCurrency = currency.toUpperCase().trim();
  const precision = getCurrencyPrecision(cleanCurrency);

  const raw = String(decimalStr).trim();
  if (!raw) {
    throw new Error(`Cannot parse empty string as Money for currency ${currency}`);
  }

  // Remove standard thousand separators (commas)
  // Check that commas are only used as thousands separators if present
  let normalized = raw;
  if (normalized.includes(',')) {
    // Validate comma placement or replace commas if standard format
    // E.g. "1,250.50" -> "1250.50"
    normalized = normalized.replace(/,/g, '');
  }

  // Strict regex for valid decimal: optional leading minus, digits, optional single dot with digits
  const decimalRegex = /^-?\d+(\.\d+)?$/;
  if (!decimalRegex.test(normalized)) {
    throw new Error(`Malformed monetary decimal string: "${raw}"`);
  }

  const isNegative = normalized.startsWith('-');
  const absStr = isNegative ? normalized.slice(1) : normalized;

  const [wholePartStr, fracPartStr = ''] = absStr.split('.');

  // Validate fractional digits count
  if (precision === 0 && fracPartStr.length > 0) {
    // Zero-decimal currency cannot have non-zero fractional digits
    const fracNum = parseInt(fracPartStr, 10);
    if (fracNum !== 0) {
      throw new Error(
        `Currency ${cleanCurrency} has 0 decimal precision, but received fractional part: "${fracPartStr}"`
      );
    }
  } else if (fracPartStr.length > precision) {
    throw new Error(
      `Excess fractional digits for currency ${cleanCurrency} (max ${precision}): "${fracPartStr}" in "${raw}"`
    );
  }

  // Pad or truncate frac to exact precision
  const paddedFrac = (fracPartStr + '0'.repeat(precision)).slice(0, precision);

  // Exact integer composition
  const wholePart = parseInt(wholePartStr, 10);
  const factor = Math.pow(10, precision);

  // Overflow pre-check
  if (wholePart > Math.floor(Number.MAX_SAFE_INTEGER / factor)) {
    throw new Error(`Monetary value causes integer overflow beyond MAX_SAFE_INTEGER: "${raw}"`);
  }

  const totalMinor = wholePart * factor + (precision > 0 ? parseInt(paddedFrac || '0', 10) : 0);

  if (totalMinor > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Monetary value causes integer overflow beyond MAX_SAFE_INTEGER: "${raw}"`);
  }

  return createMoney(isNegative ? -totalMinor : totalMinor, cleanCurrency);
}

/**
 * Format a Money object to a localized display string.
 * This is a pure function that never mutates or changes the underlying Money value.
 */
export function formatMoney(money: Money): string {
  const isNegative = money.amountMinor < 0;
  const absMinor = Math.abs(money.amountMinor);

  const symbolMap: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    CAD: 'CA$',
    AUD: 'A$',
    JPY: '¥',
  };
  const sym = symbolMap[money.currency] || `${money.currency} `;

  if (money.precision === 0) {
    const formatted = absMinor.toLocaleString('en-US');
    return `${isNegative ? '-' : ''}${sym}${formatted}`;
  }

  const factor = Math.pow(10, money.precision);
  const whole = Math.floor(absMinor / factor);
  const frac = (absMinor % factor).toString().padStart(money.precision, '0');
  const formattedWhole = whole.toLocaleString('en-US');

  return `${isNegative ? '-' : ''}${sym}${formattedWhole}.${frac}`;
}

/**
 * Convert Money object to standard decimal string (e.g. 1050 -> "10.50").
 */
export function moneyToDecimalString(money: Money): string {
  const isNegative = money.amountMinor < 0;
  const absMinor = Math.abs(money.amountMinor);

  if (money.precision === 0) {
    return `${isNegative ? '-' : ''}${absMinor}`;
  }

  const factor = Math.pow(10, money.precision);
  const whole = Math.floor(absMinor / factor);
  const frac = (absMinor % factor).toString().padStart(money.precision, '0');

  return `${isNegative ? '-' : ''}${whole}.${frac}`;
}

/**
 * Add two Money objects. Enforces strict currency matching and checks for overflow.
 */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(
      `Cannot add amounts with mismatched currencies: ${a.currency} and ${b.currency}`
    );
  }

  const sumMinor = a.amountMinor + b.amountMinor;
  if (Math.abs(sumMinor) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Addition result exceeds Number.MAX_SAFE_INTEGER: ${sumMinor}`);
  }

  return createMoney(sumMinor, a.currency);
}

/**
 * Subtract Money b from Money a. Enforces strict currency matching and checks for overflow.
 */
export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(
      `Cannot subtract amounts with mismatched currencies: ${a.currency} and ${b.currency}`
    );
  }

  const diffMinor = a.amountMinor - b.amountMinor;
  if (Math.abs(diffMinor) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Subtraction result exceeds Number.MAX_SAFE_INTEGER: ${diffMinor}`);
  }

  return createMoney(diffMinor, a.currency);
}

/**
 * Calculate absolute value of Money.
 */
export function absMoney(money: Money): Money {
  return createMoney(Math.abs(money.amountMinor), money.currency);
}

/**
 * Compares two Money objects.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 * Enforces strict currency matching.
 */
export function compareMoney(a: Money, b: Money): number {
  if (a.currency !== b.currency) {
    throw new Error(
      `Cannot compare amounts with mismatched currencies: ${a.currency} and ${b.currency}`
    );
  }

  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

/**
 * Checks if two Money amounts are strictly equal in both currency and minor units.
 */
export function isMoneyEqual(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}
