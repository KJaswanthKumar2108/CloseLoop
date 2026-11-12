import { describe, it, expect } from 'vitest';
import {
  createMoney,
  parseDecimalToMoney,
  formatMoney,
  moneyToDecimalString,
  addMoney,
  subtractMoney,
  compareMoney,
  isMoneyEqual,
  absMoney,
  getCurrencyPrecision,
} from '../money';

describe('Financial Precision — Money Module', () => {
  describe('createMoney & Currency Precision', () => {
    it('creates Money with exact integer minor units for standard 2-decimal currency (USD)', () => {
      const m = createMoney(1050, 'USD');
      expect(m.amountMinor).toBe(1050);
      expect(m.currency).toBe('USD');
      expect(m.precision).toBe(2);
    });

    it('creates Money for 0-decimal currency (JPY)', () => {
      const m = createMoney(500, 'JPY');
      expect(m.amountMinor).toBe(500);
      expect(m.currency).toBe('JPY');
      expect(m.precision).toBe(0);
    });

    it('creates Money for 3-decimal currency (BHD)', () => {
      const m = createMoney(12500, 'BHD');
      expect(m.amountMinor).toBe(12500);
      expect(m.currency).toBe('BHD');
      expect(m.precision).toBe(3);
    });

    it('rejects non-integer minor unit amounts', () => {
      expect(() => createMoney(10.5, 'USD')).toThrow(
        /Financial amounts must be integers in minor units/
      );
    });

    it('rejects invalid or malformed currency codes', () => {
      expect(() => createMoney(100, 'US')).toThrow(/Invalid ISO 4217 currency code/);
      expect(() => createMoney(100, 'USDD')).toThrow(/Invalid ISO 4217 currency code/);
    });

    it('rejects amounts exceeding MAX_SAFE_INTEGER', () => {
      expect(() => createMoney(Number.MAX_SAFE_INTEGER + 10, 'USD')).toThrow(
        /exceed Number.MAX_SAFE_INTEGER/
      );
    });

    it('correctly maps currency precision for 0, 2, and 3 decimals', () => {
      expect(getCurrencyPrecision('JPY')).toBe(0);
      expect(getCurrencyPrecision('USD')).toBe(2);
      expect(getCurrencyPrecision('BHD')).toBe(3);
    });
  });

  describe('parseDecimalToMoney', () => {
    it('parses standard 2-decimal string to integer minor units without float drift', () => {
      const m = parseDecimalToMoney('10.50', 'USD');
      expect(m.amountMinor).toBe(1050);
      expect(m.precision).toBe(2);

      const m2 = parseDecimalToMoney('0.01', 'USD');
      expect(m2.amountMinor).toBe(1);

      const m3 = parseDecimalToMoney('1234.56', 'EUR');
      expect(m3.amountMinor).toBe(123456);
    });

    it('parses whole integer strings correctly padding minor units', () => {
      const m = parseDecimalToMoney('100', 'USD');
      expect(m.amountMinor).toBe(10000);
    });

    it('parses single fractional digit by padding with zero', () => {
      const m = parseDecimalToMoney('10.5', 'USD');
      expect(m.amountMinor).toBe(1050);
    });

    it('parses formatted amounts containing commas', () => {
      const m = parseDecimalToMoney('1,250.75', 'USD');
      expect(m.amountMinor).toBe(125075);
    });

    it('parses 0-decimal currency (JPY)', () => {
      const m = parseDecimalToMoney('500', 'JPY');
      expect(m.amountMinor).toBe(500);
      expect(m.precision).toBe(0);
    });

    it('rejects 0-decimal currency with non-zero fractional digits', () => {
      expect(() => parseDecimalToMoney('500.5', 'JPY')).toThrow(
        /has 0 decimal precision, but received fractional part/
      );
    });

    it('parses 3-decimal currency (BHD, KWD)', () => {
      const m = parseDecimalToMoney('12.500', 'BHD');
      expect(m.amountMinor).toBe(12500);
      expect(m.precision).toBe(3);

      const m2 = parseDecimalToMoney('1.25', 'KWD'); // pads to 1.250
      expect(m2.amountMinor).toBe(1250);
    });

    it('preserves negative amounts for refunds and adjustments', () => {
      const m = parseDecimalToMoney('-50.25', 'USD');
      expect(m.amountMinor).toBe(-5025);

      const mJpy = parseDecimalToMoney('-1200', 'JPY');
      expect(mJpy.amountMinor).toBe(-1200);
    });

    it('rejects excess fractional digits beyond currency precision', () => {
      // USD has 2 decimals; 3 decimals must be rejected
      expect(() => parseDecimalToMoney('10.555', 'USD')).toThrow(
        /Excess fractional digits for currency USD/
      );
      // BHD has 3 decimals; 4 decimals must be rejected
      expect(() => parseDecimalToMoney('1.2345', 'BHD')).toThrow(
        /Excess fractional digits for currency BHD/
      );
    });

    it('rejects malformed monetary strings', () => {
      expect(() => parseDecimalToMoney('10..50', 'USD')).toThrow(/Malformed monetary decimal/);
      expect(() => parseDecimalToMoney('--10.50', 'USD')).toThrow(/Malformed monetary decimal/);
      expect(() => parseDecimalToMoney('abc', 'USD')).toThrow(/Malformed monetary decimal/);
      expect(() => parseDecimalToMoney('', 'USD')).toThrow(/Cannot parse empty string/);
      expect(() => parseDecimalToMoney('10.5.0', 'USD')).toThrow(/Malformed monetary decimal/);
    });

    it('rejects input that overflows MAX_SAFE_INTEGER', () => {
      expect(() => parseDecimalToMoney('99999999999999999999.99', 'USD')).toThrow(
        /causes integer overflow/
      );
    });
  });

  describe('formatMoney & moneyToDecimalString', () => {
    it('formats USD cleanly with symbol and cents', () => {
      expect(formatMoney(createMoney(1050, 'USD'))).toBe('$10.50');
      expect(formatMoney(createMoney(5, 'USD'))).toBe('$0.05');
      expect(formatMoney(createMoney(0, 'USD'))).toBe('$0.00');
    });

    it('formats negative amounts with minus sign', () => {
      expect(formatMoney(createMoney(-5000, 'USD'))).toBe('-$50.00');
    });

    it('formats JPY with no decimal points', () => {
      expect(formatMoney(createMoney(1500, 'JPY'))).toBe('¥1,500');
      expect(formatMoney(createMoney(-300, 'JPY'))).toBe('-¥300');
    });

    it('converts to pure unadorned decimal string', () => {
      expect(moneyToDecimalString(createMoney(1050, 'USD'))).toBe('10.50');
      expect(moneyToDecimalString(createMoney(-50, 'USD'))).toBe('-0.50');
      expect(moneyToDecimalString(createMoney(1500, 'JPY'))).toBe('1500');
      expect(moneyToDecimalString(createMoney(12345, 'BHD'))).toBe('12.345');
    });

    it('guarantees formatting never mutates or changes underlying Money object', () => {
      const original = createMoney(9999, 'USD');
      const copy = { ...original };
      formatMoney(original);
      moneyToDecimalString(original);
      expect(original).toEqual(copy);
    });
  });

  describe('addMoney, subtractMoney & compareMoney', () => {
    it('adds amounts in same currency accurately without float drift', () => {
      const a = parseDecimalToMoney('0.10', 'USD');
      const b = parseDecimalToMoney('0.20', 'USD');
      const sum = addMoney(a, b);
      expect(sum.amountMinor).toBe(30); // 30 cents, exactly 0.30
      expect(moneyToDecimalString(sum)).toBe('0.30');
    });

    it('subtracts amounts in same currency accurately', () => {
      const a = parseDecimalToMoney('100.00', 'USD');
      const b = parseDecimalToMoney('25.50', 'USD');
      const diff = subtractMoney(a, b);
      expect(diff.amountMinor).toBe(7450);
      expect(moneyToDecimalString(diff)).toBe('74.50');
    });

    it('rejects adding different currencies without explicit conversion', () => {
      const usd = createMoney(1000, 'USD');
      const eur = createMoney(1000, 'EUR');
      expect(() => addMoney(usd, eur)).toThrow(
        /Cannot add amounts with mismatched currencies: USD and EUR/
      );
    });

    it('rejects subtracting different currencies without explicit conversion', () => {
      const usd = createMoney(1000, 'USD');
      const gbp = createMoney(1000, 'GBP');
      expect(() => subtractMoney(usd, gbp)).toThrow(
        /Cannot subtract amounts with mismatched currencies: USD and GBP/
      );
    });

    it('compares amounts correctly', () => {
      const a = createMoney(1000, 'USD');
      const b = createMoney(2000, 'USD');
      const c = createMoney(1000, 'USD');

      expect(compareMoney(a, b)).toBe(-1);
      expect(compareMoney(b, a)).toBe(1);
      expect(compareMoney(a, c)).toBe(0);
      expect(isMoneyEqual(a, c)).toBe(true);
      expect(isMoneyEqual(a, b)).toBe(false);
    });

    it('rejects comparing different currencies', () => {
      const a = createMoney(1000, 'USD');
      const b = createMoney(1000, 'CAD');
      expect(() => compareMoney(a, b)).toThrow(
        /Cannot compare amounts with mismatched currencies/
      );
    });

    it('computes absolute value', () => {
      const neg = createMoney(-1500, 'USD');
      expect(absMoney(neg).amountMinor).toBe(1500);
    });
  });
});
