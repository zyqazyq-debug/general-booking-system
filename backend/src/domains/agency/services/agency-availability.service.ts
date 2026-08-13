import { Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AgencyNode } from '../entities/agency-node.entity';

type OrderRecord = {
  service_id: string | null;
  start_time: Date;
  end_time: Date;
  status: string;
};

@Injectable()
export class AgencyAvailabilityService {
  constructor(
    @InjectRepository(AgencyNode)
    private readonly agencyRepository: Repository<AgencyNode>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async getCollectionAvailability(
    agentId: string,
    dateStr: string,
  ): Promise<Record<string, string>> {
    if (!dateStr) return {};

    const nodes = await this.agencyRepository
      .createQueryBuilder('node')
      .leftJoinAndSelect('node.service', 'service')
      .where('node.agent_id = :agentId', { agentId })
      .andWhere('node.status != :deletedStatus', { deletedStatus: 'DELETED' })
      .getMany();

    const targetDate = new Date(dateStr);
    const dayOfWeek = targetDate.getDay(); // 0-6 (0=Sunday)

    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const results: Record<string, string> = {};
    const serviceIds = Array.from(
      new Set(nodes.map((node) => node.service_id).filter(Boolean)),
    );

    const bookedMinutesByService = new Map<string, number>();
    if (serviceIds.length > 0) {
      const orderRepository =
        this.dataSource.getRepository<OrderRecord>('Order');
      const orders = await orderRepository
        .createQueryBuilder('order')
        .where('order.service_id IN (:...serviceIds)', { serviceIds })
        .andWhere('order.status NOT IN (:...excluded)', {
          excluded: ['CANCELLED', 'FORFEITED'],
        })
        .andWhere('order.start_time < :end', { end: endOfDay })
        .andWhere('order.end_time > :start', { start: startOfDay })
        .select(['order.service_id', 'order.start_time', 'order.end_time'])
        .getMany();

      for (const order of orders) {
        if (!order.service_id) continue;
        const oStart = Math.max(
          order.start_time.getTime(),
          startOfDay.getTime(),
        );
        const oEnd = Math.min(order.end_time.getTime(), endOfDay.getTime());
        const minutes = (oEnd - oStart) / (1000 * 60);
        const prev = bookedMinutesByService.get(order.service_id) || 0;
        bookedMinutesByService.set(order.service_id, prev + minutes);
      }
    }

    for (const node of nodes) {
      const service = node.service;
      if (service && (service.is_deleted || !service.is_active)) {
        results[node.id] = 'off';
        continue;
      }
      if (!service || !service.rules) {
        results[node.id] = 'unknown';
        continue;
      }

      const rules = (service.rules || null) as {
        weekdays?: Array<number | string>;
        start_hour?: number | string;
        end_hour?: number | string;
      } | null;
      const weekdays = Array.isArray(rules?.weekdays)
        ? rules.weekdays.map((d) => (Number(d) === 7 ? 0 : Number(d)))
        : [];

      if (!weekdays.includes(dayOfWeek)) {
        results[node.id] = 'off';
        continue;
      }

      const startHour = Number(rules?.start_hour ?? 0) || 0;
      const endHour = Number(rules?.end_hour ?? 24) || 24;
      const totalMinutes = (endHour - startHour) * 60;
      const duration = Number(service.duration_minutes) || 60;
      const bookedMinutes = bookedMinutesByService.get(service.id) || 0;
      const remainingMinutes = totalMinutes - bookedMinutes;

      if (remainingMinutes < duration) {
        results[node.id] = 'full';
      } else if (remainingMinutes < duration * 2) {
        results[node.id] = 'limited';
      } else {
        results[node.id] = 'available';
      }
    }

    return results;
  }
}
