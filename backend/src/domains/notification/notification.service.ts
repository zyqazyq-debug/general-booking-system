import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private eventEmitter: EventEmitter2) {}

  async trigger(event: string, payload: any) {
    this.logger.log(`Triggering event ${event}`);
    this.eventEmitter.emit(event, payload);
    return Promise.resolve();
  }
}
