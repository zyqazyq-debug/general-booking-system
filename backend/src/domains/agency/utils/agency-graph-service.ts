import { Repository } from 'typeorm';
import { AgencyNode } from '../entities/agency-node.entity';
import { PriceCalculator } from './price-calculator';

export class AgencyGraphService {
  constructor(private agencyRepository: Repository<AgencyNode>) {}

  /**
   * Recursive (Old) Price Propagation
   */
  async propagatePriceUpdate(parentNodeId: string, parentTotalPrice: number) {
    // Find all direct children
    const children = await this.agencyRepository.find({
      where: { parent_node_id: parentNodeId },
    });

    if (!children.length) return;

    for (const child of children) {
      // Update cost price from parent's total price
      child.cache_cost_price = parentTotalPrice;

      // Recalculate child's markup_amount
      child.markup_amount = PriceCalculator.calculateMarkupAmount(
        child.cache_cost_price,
        child.markup_type,
        child.markup_value,
      );

      // Update total price
      child.cache_total_price = PriceCalculator.calculateTotalPrice(
        child.cache_cost_price,
        child.markup_amount,
      );

      const savedChild = await this.agencyRepository.save(child);

      // Recursively update this child's children
      await this.propagatePriceUpdate(child.id, savedChild.cache_total_price);
    }
  }

  /**
   * Recursive SQL-Based Propagation (To Avoid Memory OOM)
   * Uses a recursive CTE to find all descendants and updates them layer by layer or one by one
   * Ideally, we should use a Stored Procedure for maximum performance, but here we use iterative updates based on depth.
   */
  async propagatePriceUpdateOptimized(
    serviceId: string,
    rootNodeId: string,
    rootTotalPrice: number,
  ) {
    // Revert to recursive propagation for now to avoid OOM on large datasets
    // In a real production environment with 10k+ nodes, we should use a database stored procedure
    // or a worker queue to process updates in background.
    // For now, simple recursion is safer than loading all nodes into memory.
    await this.propagatePriceUpdate(rootNodeId, rootTotalPrice);
  }
}
