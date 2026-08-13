import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhysicalResource } from './entities/physical-resource.entity';
import { ResourceTemplate } from './entities/resource-template.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PhysicalResource, ResourceTemplate])],
  exports: [TypeOrmModule],
})
export class ResourcesModule {}
