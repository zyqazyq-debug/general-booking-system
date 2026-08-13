import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { randomBytes } from 'crypto';
import { AgencyNode } from '../entities/agency-node.entity';
import { CollectionQuotaSubscription } from './entities/collection-quota-subscription.entity';
import { CollectionQuotaBill } from './entities/collection-quota-bill.entity';
import { PaymentChannel } from '../../payment';
import { CreateCollectionQuotaPurchaseIntentDto } from './dto/create-collection-quota-purchase-intent.dto';
import { BusinessException } from '../../../shared/common/exceptions/business.exception';
import { BusinessErrorCode } from '../../../shared/common/exceptions/business-error-code';
import type { AgencySystemConfigPort } from '../ports/agency-system-config.port';
import { AGENCY_SYSTEM_CONFIG_PORT } from '../ports/tokens';

@Injectable()
export class CollectionQuotaService {
  private readonly defaultBaseLimit = 20;
  private readonly defaultUnitPriceMonthly = 1;
  private readonly purchaseEndpoint =
    '/agency/collection-quota/purchase-intent';
  private readonly paymentPrepayEndpoint = '/payment/prepay';

  constructor(
    @InjectRepository(AgencyNode)
    private readonly agencyRepository: Repository<AgencyNode>,
    @InjectRepository(CollectionQuotaSubscription)
    private readonly subscriptionRepository: Repository<CollectionQuotaSubscription>,
    @InjectRepository(CollectionQuotaBill)
    private readonly billRepository: Repository<CollectionQuotaBill>,
    @Inject(AGENCY_SYSTEM_CONFIG_PORT)
    private readonly systemConfigPort: AgencySystemConfigPort,
  ) {}

  async getQuota(userId: string) {
    const baseLimit = await this.systemConfigPort.getNumber(
      'agency.quota.base_limit',
      this.defaultBaseLimit,
    );
    const unitPriceMonthly = await this.systemConfigPort.getNumber(
      'agency.quota.unit_price_monthly',
      this.defaultUnitPriceMonthly,
    );

    const [activeCount, subscriptions] = await Promise.all([
      this.agencyRepository.count({
        where: { agent_id: userId, status: 'ACTIVE' },
      }),
      this.subscriptionRepository.find({
        where: {
          user_id: userId,
          status: 'ACTIVE',
          cycle_end: MoreThan(new Date()),
        },
      }),
    ]);

    const extraSlots = subscriptions.reduce(
      (sum, item) => sum + Number(item.extra_slots || 0),
      0,
    );
    const activeLimit = baseLimit + extraSlots;

    return {
      base_limit: baseLimit,
      extra_slots: extraSlots,
      active_limit: activeLimit,
      active_count: activeCount,
      remaining_slots: Math.max(0, activeLimit - activeCount),
      unit_price_monthly: unitPriceMonthly,
      purchase_endpoint: this.purchaseEndpoint,
    };
  }

  async assertCanActivate(userId: string, requiredSlots = 1) {
    const quota = await this.getQuota(userId);
    const required = Math.max(1, Number(requiredSlots || 1));
    if (quota.active_count + required > quota.active_limit) {
      throw BusinessException.badRequest({
        message: 'Collection active limit exceeded',
        error_code: BusinessErrorCode.COLLECTION_ACTIVE_LIMIT_EXCEEDED,
        details: {
          active_count: quota.active_count,
          active_limit: quota.active_limit,
          required_slots: required,
          shortfall: quota.active_count + required - quota.active_limit,
          purchase_endpoint: this.purchaseEndpoint,
        },
      });
    }
    return quota;
  }

  async createPurchaseIntent(
    userId: string,
    dto: CreateCollectionQuotaPurchaseIntentDto,
  ) {
    const unitPriceMonthly = await this.systemConfigPort.getNumber(
      'agency.quota.unit_price_monthly',
      this.defaultUnitPriceMonthly,
    );

    const extraSlots = Number(dto.extra_slots || 0);
    const months = Number(dto.months || 1);
    const channel = dto.channel || PaymentChannel.WECHAT;
    const amount = Number((extraSlots * months * unitPriceMonthly).toFixed(2));
    const orderNo = `quota_${Date.now()}_${randomBytes(3).toString('hex')}`;
    const subject = `收藏上架扩容 ${extraSlots} 条 x ${months} 月`;

    const bill = this.billRepository.create({
      order_no: orderNo,
      user_id: userId,
      extra_slots: extraSlots,
      months,
      amount,
      status: 'PENDING',
      channel,
      metadata: {
        business_type: 'collection_quota',
      },
    });
    await this.billRepository.save(bill);

    return {
      status: 'PENDING_INTEGRATION',
      order_no: orderNo,
      user_id: userId,
      extra_slots: extraSlots,
      months,
      unit_price_monthly: unitPriceMonthly,
      amount,
      subject,
      channel,
      purchase_endpoint: this.paymentPrepayEndpoint,
      payment_payload: {
        channel,
        order_no: orderNo,
        amount,
        subject,
        metadata: {
          business_type: 'collection_quota',
          user_id: userId,
          extra_slots: extraSlots,
          months,
        },
      },
      message: '收藏上架扩容购买接口预留成功',
    };
  }
}
