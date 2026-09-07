import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { CommissionRecord } from '../../agency';
import { Service } from '../../services';

type UserLite = {
  id: string;
  nickname?: string | null;
  username?: string | null;
};

@Injectable()
export class OrderContextQueryService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  async findOneWithContext(id: string, actorId?: string) {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: [
        'service',
        'service.owner',
        'owner',
        'consumer',
        'agency_node',
        'agency_node.agent',
      ],
    });

    if (!order) return null;

    let contextRole: 'CONSUMER' | 'PROVIDER' | 'AGENT' | null = null;
    let upstream: { id: string; nickname: string; role: string } | null = null;
    let downstream: { id: string; nickname: string; role: string } | null =
      null;
    let myCommission: CommissionRecord | null = null;

    const commissions = await this.orderRepository.manager.find(
      CommissionRecord,
      {
        where: { order_id: id },
        order: { level: 'ASC' },
        relations: ['agent'],
      },
    );

    if (actorId) {
      const isConsumer = order.consumer_id === actorId;
      const isProvider = order.owner_id === actorId;
      const myRecord = commissions.find((c) => c.agent_id === actorId) || null;
      const isAgent = !!myRecord;

      if (!isConsumer && !isProvider && !isAgent) {
        throw new ForbiddenException('Not authorized to view this order');
      }

      if (!order.service && order.service_snapshot) {
        order.service = {
          ...order.service_snapshot,
          id: order.service_id,
          owner_id: order.owner_id,
          is_active: false,
          created_at: new Date(),
          updated_at: new Date(),
        } as Service;
      }

      if (isConsumer) {
        contextRole = 'CONSUMER';
        if (commissions.length > 0) {
          const last = commissions[commissions.length - 1];
          const lastAgent = last.agent as unknown as UserLite;
          upstream = {
            id: lastAgent?.id || 'unknown',
            nickname: lastAgent?.nickname || lastAgent?.username || '未知代理',
            role: last.role,
          };
        } else {
          const orderOwner = order.owner as unknown;
          const provider = orderOwner;
          const providerUser = provider as UserLite | null;
          upstream = {
            id: providerUser?.id || 'unknown',
            nickname:
              providerUser?.nickname ||
              providerUser?.username ||
              'Unknown Provider',
            role: 'PROVIDER',
          };
        }
      } else if (isProvider) {
        contextRole = 'PROVIDER';
        const providerRecord = commissions.find(
          (c) => c.level === 0 && c.role === 'PROVIDER',
        );
        if (providerRecord) {
          if (providerRecord.child_agent_id) {
            const childRecord = commissions.find(
              (c) =>
                (c.agent as unknown as UserLite).id ===
                providerRecord.child_agent_id,
            );
            if (childRecord) {
              const childAgent = childRecord.agent as unknown as UserLite;
              downstream = {
                id: childAgent?.id || 'unknown',
                nickname:
                  childAgent?.nickname || childAgent?.username || '未知代理',
                role: childRecord.role,
              };
            } else {
              downstream = {
                id: providerRecord.child_agent_id,
                role: 'AGENT',
                nickname: '未知代理',
              };
            }
          } else {
            const consumerUser = order.consumer as unknown as UserLite;
            downstream = {
              id: consumerUser?.id || order.consumer_id,
              nickname:
                consumerUser?.nickname || consumerUser?.username || '消费者',
              role: 'CONSUMER',
            };
          }
        } else {
          const consumerUser = order.consumer as unknown as UserLite;
          downstream = {
            id: consumerUser?.id || order.consumer_id,
            nickname:
              consumerUser?.nickname || consumerUser?.username || '消费者',
            role: 'CONSUMER',
          };
        }
      } else if (isAgent) {
        contextRole = 'AGENT';
        myCommission = myRecord;

        if (myRecord.level > 0) {
          const prev = commissions.find((c) => c.level === myRecord.level - 1);
          if (prev) {
            const prevAgent = prev.agent as unknown as UserLite;
            upstream = {
              id: prevAgent?.id || 'unknown',
              nickname:
                prevAgent?.nickname || prevAgent?.username || '未知代理',
              role: prev.role,
            };
          }
        }

        if (myRecord.child_agent_id) {
          const next = commissions.find((c) => c.level === myRecord.level + 1);
          if (next) {
            const nextAgent = next.agent as unknown as UserLite;
            downstream = {
              id: nextAgent?.id || 'unknown',
              nickname:
                nextAgent?.nickname || nextAgent?.username || '未知代理',
              role: 'AGENT',
            };
          } else {
            downstream = {
              id: myRecord.child_agent_id,
              role: 'AGENT',
              nickname: '未知代理',
            };
          }
        } else {
          const consumerUser = order.consumer as unknown as UserLite;
          downstream = {
            id: consumerUser?.id || order.consumer_id,
            nickname:
              consumerUser?.nickname || consumerUser?.username || '消费者',
            role: 'CONSUMER',
          };
        }
      }
    }

    return {
      ...order,
      context_role: contextRole,
      context_info: {
        upstream,
        downstream,
        commission: myCommission,
      },
    };
  }
}
