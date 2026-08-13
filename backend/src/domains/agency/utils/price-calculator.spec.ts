import { PriceCalculator } from './price-calculator';

describe('PriceCalculator', () => {
  describe('calculateMarkupAmount', () => {
    it('should calculate PERCENT markup correctly', () => {
      expect(PriceCalculator.calculateMarkupAmount(100, 'PERCENT', 10)).toBe(
        10,
      );
      expect(PriceCalculator.calculateMarkupAmount(100, 'PERCENTAGE', 15)).toBe(
        15,
      );
      expect(PriceCalculator.calculateMarkupAmount(50, 'PERCENT', 5.5)).toBe(
        2.75,
      );
    });

    it('should calculate FIXED markup correctly', () => {
      expect(PriceCalculator.calculateMarkupAmount(100, 'FIXED', 20)).toBe(20);
      expect(PriceCalculator.calculateMarkupAmount(50, 'FIXED', 10.5)).toBe(
        10.5,
      );
    });

    it('should handle extreme and edge case values', () => {
      // 负数处理 (如果允许负加价的情况)
      expect(PriceCalculator.calculateMarkupAmount(100, 'FIXED', -20)).toBe(
        -20,
      );
      expect(PriceCalculator.calculateMarkupAmount(100, 'PERCENT', -10)).toBe(
        -10,
      );

      // 极小小数处理，检查是否保留了2位小数
      expect(PriceCalculator.calculateMarkupAmount(100, 'PERCENT', 0.111)).toBe(
        0.11,
      );
      expect(
        PriceCalculator.calculateMarkupAmount(100.555, 'PERCENT', 10),
      ).toBe(10.06);

      // 0基数
      expect(PriceCalculator.calculateMarkupAmount(0, 'PERCENT', 10)).toBe(0);
      expect(PriceCalculator.calculateMarkupAmount(0, 'FIXED', 10)).toBe(10);
    });
  });

  describe('calculateTotalPrice', () => {
    it('should add cost price and markup amount correctly', () => {
      expect(PriceCalculator.calculateTotalPrice(100, 20)).toBe(120);
      expect(PriceCalculator.calculateTotalPrice(50.5, 10.25)).toBe(60.75);
    });

    it('should handle zero and negative values correctly', () => {
      expect(PriceCalculator.calculateTotalPrice(0, 0)).toBe(0);
      expect(PriceCalculator.calculateTotalPrice(100, -10)).toBe(90);
    });

    it('should handle extreme decimals correctly', () => {
      // 0.1 + 0.2 = 0.30000000000000004 -> 0.30
      expect(PriceCalculator.calculateTotalPrice(0.1, 0.2)).toBe(0.3);
      // 多位小数会被截断到两位
      expect(PriceCalculator.calculateTotalPrice(10.555, 5.555)).toBe(16.11);
    });
  });
});
