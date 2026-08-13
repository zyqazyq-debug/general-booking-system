import { EntityManager, Repository } from 'typeorm';
import { CommissionRecord } from '../entities/commission-record.entity';
import { PriceStrategyService } from './price-strategy';

export interface AgencyNodeLookupPort {
  findById(id: string): Promise<{
    agent_id: string;
    parent_node_id: string | null;
    markup_type: string | null;
    markup_value: number | string | null;
  } | null>;
}

export interface CommissionCalculationInput {
  orderId: string;
  providerId: string;
  basePrice: number;
  agencyNodeId?: string | null;
}

type ChainNode = {
  agent_id: string;
  markup_type: string;
  markup_value: number;
  role: 'AGENT' | 'PROVIDER';
};

export class CommissionCalculator {
  constructor(
    private readonly agencyPort: AgencyNodeLookupPort,
    private readonly commissionRepository: Repository<CommissionRecord>,
  ) {}

  async calculateAndSave(
    input: CommissionCalculationInput,
    queryRunnerManager?: EntityManager,
  ): Promise<void> {
    const agentChain: ChainNode[] = [];

    if (input.agencyNodeId) {
      let currentNode = await this.agencyPort.findById(input.agencyNodeId);
      let depth = 0;
      while (currentNode && depth < 20) {
        if (currentNode.agent_id === input.providerId) {
          break;
        }
        agentChain.push({
          agent_id: currentNode.agent_id,
          markup_type: currentNode.markup_type || 'FIXED',
          markup_value: Number(currentNode.markup_value),
          role: 'AGENT',
        });

        if (currentNode.parent_node_id) {
          currentNode = await this.agencyPort.findById(
            currentNode.parent_node_id,
          );
        } else {
          break;
        }
        depth++;
      }
    }

    agentChain.push({
      agent_id: input.providerId,
      markup_type: 'FIXED',
      markup_value: Number(input.basePrice),
      role: 'PROVIDER',
    });

    const topDownChain = agentChain.reverse();
    let runningPrice = 0;

    for (let i = 0; i < topDownChain.length; i++) {
      const node = topDownChain[i];
      const isProvider = node.role === 'PROVIDER';
      const costPrice = isProvider ? 0 : runningPrice;
      const markupAmount = isProvider
        ? node.markup_value
        : PriceStrategyService.calculateMarkupAmount(
            costPrice,
            node.markup_value,
            node.markup_type,
          );

      const finalPrice = costPrice + markupAmount;
      runningPrice = finalPrice;

      const nextNode = topDownChain[i + 1];
      const childAgentId = nextNode ? nextNode.agent_id : null;

      const record = this.commissionRepository.create({
        order_id: input.orderId,
        agent_id: node.agent_id,
        role: node.role,
        cost_price: costPrice,
        markup_amount: markupAmount,
        final_price: finalPrice,
        child_agent_id: childAgentId,
        level: i,
        snapshot_markup_type: node.markup_type,
        snapshot_markup_value: node.markup_value,
      });

      if (queryRunnerManager) {
        await queryRunnerManager.save(CommissionRecord, record);
      } else {
        await this.commissionRepository.save(record);
      }
    }
  }
}
