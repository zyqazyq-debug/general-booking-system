import { Injectable } from '@nestjs/common';
import { ServicesService } from '../services.service';
import type { CleanupTasksServicesPort } from '../../../platforms/tasks/ports/cleanup-tasks-services.port';

@Injectable()
export class CleanupTasksServicesAdapter implements CleanupTasksServicesPort {
  constructor(private readonly servicesService: ServicesService) {}

  cleanupExpiredBlocks(): Promise<number> {
    return this.servicesService.cleanupExpiredBlocks();
  }
}
