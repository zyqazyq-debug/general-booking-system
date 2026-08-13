import Decimal from 'decimal.js';

export class PriceCalculator {
  static calculateMarkupAmount(
    costPrice: number,
    markupType: string,
    markupValue: number,
  ): number {
    const normalizedType = (markupType || '').toUpperCase();
    const cost = new Decimal(costPrice);
    const value = new Decimal(markupValue);

    if (normalizedType === 'PERCENT' || normalizedType === 'PERCENTAGE') {
      // cost * (value / 100)
      return cost.mul(value.div(100)).toDecimalPlaces(2).toNumber();
    }
    return value.toNumber();
  }

  static calculateTotalPrice(costPrice: number, markupAmount: number): number {
    const cost = new Decimal(costPrice);
    const markup = new Decimal(markupAmount);
    return cost.add(markup).toDecimalPlaces(2).toNumber();
  }
}
