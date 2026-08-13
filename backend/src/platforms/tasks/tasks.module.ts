import { Module } from '@nestjs/common';
import { CleanupTasksService } from './services/cleanup-tasks.service';

@Module({
  providers: [CleanupTasksService],
})
export class TasksModule {}
