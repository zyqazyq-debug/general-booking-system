import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import type { OrderAgencyPort } from '../ports/order-agency.port';
import {
  ORDER_AGENCY_PORT,
  ORDER_NOTIFICATION_PORT,
  ORDER_USERS_PORT,
  ORDER_SERVICES_PORT,
} from '../ports/tokens';
import type { OrderNotificationPort } from '../ports/order-notification.port';
import type { OrderUsersPort } from '../ports/order-users.port';
import type { OrderServicesPort } from '../ports/order-services.port';
import { OrderNotificationDeliveryService } from '../outbox/order-notification-delivery.service';

@Injectable()
export class OrderNotificationService {
  private readonly logger = new Logger(OrderNotificationService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @Inject(ORDER_SERVICES_PORT)
    private readonly servicesPort: OrderServicesPort,
    @Inject(ORDER_AGENCY_PORT)
    private readonly agencyPort: OrderAgencyPort,
    @Inject(ORDER_USERS_PORT)
    private readonly usersPort: OrderUsersPort,
    @Inject(ORDER_NOTIFICATION_PORT)
    private readonly notificationPort: OrderNotificationPort,
    private readonly deliveryService: OrderNotificationDeliveryService,
  ) {}

  async notifyNewOrder(orderId: string, eventId: string): Promise<void> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) return;

    const serviceInfo = order.service_id
      ? await this.servicesPort.findServiceInfoById(order.service_id)
      : null;
    const service = order.service_snapshot || serviceInfo;
    const startTime = new Date(order.start_time).toLocaleString('zh-CN', {
      hour12: false,
    });
    const endTime = new Date(order.end_time).toLocaleString('zh-CN', {
      hour12: false,
    });
    const duration = Math.max(
      0,
      Math.round(
        (new Date(order.end_time).getTime() -
          new Date(order.start_time).getTime()) /
          60000,
      ),
    );
    const originalPrice = service?.base_price || 0;
    const finalPrice = order.display_price_snapshot || originalPrice;
    let serviceName = service?.title || '未命名服务';
    if (order.agency_node_id) {
      const node = await this.agencyPort.findById(order.agency_node_id);
      if (node?.alias) serviceName = node.alias;
    }
    const consumer = await this.usersPort.findContactById(order.consumer_id);
    const providerId = order.owner_id || serviceInfo?.owner_id || '';
    const provider = providerId
      ? await this.usersPort.findContactById(providerId)
      : null;
    const providerName =
      provider?.nickname || provider?.username || '未知服务者';
    const consumerName = consumer?.nickname || consumer?.username || '未知用户';
    const summary = [
      '【预约订单通知】',
      '────────────────',
      `服务: ${serviceName}`,
      `服务者: ${providerName}`,
      `客户: ${consumerName}`,
      `时间: ${startTime} - ${endTime}`,
      `时长: ${duration} 分钟`,
      `原价: ¥${originalPrice}`,
      `成交价: ¥${finalPrice}`,
      `订单号: ${order.order_no}`,
    ].join('\n');

    if (consumer) {
      await this.deliveryService.sendOnce(
        eventId,
        `consumer:${consumer.id}`,
        () =>
          this.notificationPort.sendDirectMessage(
            consumer.id,
            `${summary}\n\n请按时前往。`,
          ),
      );
    }

    if (providerId) {
      await this.deliveryService.sendOnce(
        eventId,
        `provider:${providerId}`,
        () =>
          this.notificationPort.sendDirectMessage(
            providerId,
            `${summary}\n\n请及时处理。`,
          ),
      );
    }
  }

  async notifyOrderStatusChange(
    orderId: string,
    newStatus: OrderStatus,
  ): Promise<void> {
    try {
      const order = await this.orderRepository.findOne({
        where: { id: orderId },
      });
      if (!order) return;

      const serviceInfo = order.service_id
        ? await this.servicesPort.findServiceInfoById(order.service_id)
        : null;
      const serviceName =
        order.service_snapshot?.title || serviceInfo?.title || '未命名服务';
      const statusMap: Record<string, string> = {
        [OrderStatus.RESERVED]: '已预约',
        [OrderStatus.COMPLETED]: '已完成',
        [OrderStatus.CANCELLED]: '已取消',
        [OrderStatus.FORFEITED]: '未到店/已违约',
        [OrderStatus.DISPUTED]: '争议中',
      };

      const message = [
        `【订单状态变更】`,
        `────────────────`,
        `服务: ${serviceName}`,
        `状态: ${statusMap[newStatus] || newStatus}`,
        `订单号: ${order.order_no}`,
        `时间: ${new Date(order.start_time).toLocaleString('zh-CN')}`,
      ].join('\n');

      await this.notificationPort.sendDirectMessage(order.consumer_id, message);

      const providerId = order.owner_id || serviceInfo?.owner_id || '';
      if (providerId) {
        await this.notificationPort.sendDirectMessage(providerId, message);
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.logger.error(
        `Failed to notify status change for order ${orderId}`,
        error.stack,
      );
    }
  }
}
