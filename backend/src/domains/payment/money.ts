import Decimal from 'decimal.js';

const CNY_MINOR_FACTOR = new Decimal(100);

export function cnyToMinorUnits(value: Decimal.Value): number {
  const decimal = new Decimal(value);
  const minor = decimal.mul(CNY_MINOR_FACTOR);

  if (!decimal.isFinite() || !decimal.isPositive() || !minor.isInteger()) {
    throw new Error(
      'Amount must be a positive CNY value with at most 2 decimals',
    );
  }

  if (minor.greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Amount exceeds the supported safe integer range');
  }

  return minor.toNumber();
}

export function cnyMinorUnitsToDecimal(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Minor-unit amount must be a positive safe integer');
  }

  return new Decimal(value).div(CNY_MINOR_FACTOR).toFixed(2);
}
