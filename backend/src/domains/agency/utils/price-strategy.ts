export class PriceStrategyService {
  /**
   * Calculates the final price based on base price and markup.
   * @param basePrice The cost price
   * @param markupValue The markup value (e.g., 10 for 10% or 10 for fixed amount)
   * @param markupType 'FIXED' or 'PERCENT'
   * @returns The calculated final price (number)
   */
  static calculateFinalPrice(
    basePrice: number,
    markupValue: number,
    markupType: string,
  ): number {
    const base = Number(basePrice);
    const value = Number(markupValue);

    if (markupType === 'FIXED') {
      return base + value;
    } else {
      // PERCENT: base + (base * value / 100)
      return base * (1 + value / 100);
    }
  }

  /**
   * Calculates the markup amount only.
   * @param basePrice The cost price
   * @param markupValue The markup value
   * @param markupType 'FIXED' or 'PERCENT'
   * @returns The calculated markup amount
   */
  static calculateMarkupAmount(
    basePrice: number,
    markupValue: number,
    markupType: string,
  ): number {
    const base = Number(basePrice);
    const value = Number(markupValue);

    if (markupType === 'FIXED') {
      return value;
    } else {
      return base * (value / 100);
    }
  }
}
