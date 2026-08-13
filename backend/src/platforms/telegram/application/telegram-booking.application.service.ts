import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import type {
  PlatformAgencyNodeDto,
  PlatformAgencyPort,
  PlatformOrderDto,
  PlatformOrderPort,
  PlatformServicesPort,
  PlatformUsersPort,
} from '../../platform-ports';
import {
  PLATFORM_AGENCY_PORT,
  PLATFORM_ORDER_PORT,
  PLATFORM_SERVICES_PORT,
  PLATFORM_USERS_PORT,
} from '../../platform-ports';

export type TelegramAvailableSlot = {
  start_time: string;
  end_time: string;
  status: string;
};

@Injectable()
export class TelegramBookingApplicationService {
  constructor(
    @Inject(PLATFORM_SERVICES_PORT)
    private readonly servicesPort: PlatformServicesPort,
    @Inject(PLATFORM_ORDER_PORT)
    private readonly orderPort: PlatformOrderPort,
    @Inject(PLATFORM_USERS_PORT)
    private readonly usersPort: PlatformUsersPort,
    @Inject(PLATFORM_AGENCY_PORT)
    private readonly agencyPort: PlatformAgencyPort,
  ) {}

  async getAvailableSlotsByCollection(
    collectionId: string,
    dateStr: string,
  ): Promise<{
    collection: PlatformAgencyNodeDto;
    availableSlots: TelegramAvailableSlot[];
  }> {
    const collection = await this.agencyPort.findById(collectionId);
    if (!collection) {
      throw new NotFoundException('收藏不存在');
    }

    const slots = (await this.servicesPort.getAvailableSlots(
      collection.service_id,
      dateStr,
    )) as TelegramAvailableSlot[];

    const availableSlots = slots.filter((s) => s.status === 'available');
    return { collection, availableSlots };
  }

  async createBookingByCollectionSlot(params: {
    chatId: string;
    collectionId: string;
    dateStr: string;
    timeStr: string;
  }): Promise<{
    order: PlatformOrderDto;
    collection: PlatformAgencyNodeDto;
    endDateTime: Date;
  }> {
    const user = await this.usersPort.findByTelegram(params.chatId);
    if (!user) {
      throw new NotFoundException('用户未注册');
    }

    const collection = await this.agencyPort.findById(params.collectionId);
    if (!collection) {
      throw new NotFoundException('收藏失效');
    }

    const startDateTime = new Date(`${params.dateStr}T${params.timeStr}:00`);
    const duration = collection.service?.duration_minutes || 60;
    const endDateTime = new Date(startDateTime.getTime() + duration * 60000);

    const order = await this.orderPort.create({
      consumer_id: user.id,
      service_id: collection.service_id,
      start_time: startDateTime.toISOString(),
      end_time: endDateTime.toISOString(),
      agency_node_id: collection.id,
    });

    return { order, collection, endDateTime };
  }
}
