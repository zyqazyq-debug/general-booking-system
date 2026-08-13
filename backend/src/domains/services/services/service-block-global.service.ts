import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CreateServiceBlockDto } from '../dto/create-service-block.dto';
import { UpdateServiceBlockDto } from '../dto/update-service-block.dto';
import { ServiceBlock } from '../entities/service-block.entity';
import { Service } from '../entities/service.entity';
import { ServiceBlockSupportService } from './service-block-support.service';

@Injectable()
export class ServiceBlockGlobalService {
  constructor(
    @InjectRepository(Service)
    private readonly servicesRepository: Repository<Service>,
    @InjectRepository(ServiceBlock)
    private readonly serviceBlockRepository: Repository<ServiceBlock>,
    private readonly supportService: ServiceBlockSupportService,
  ) {}

  async applyInferredGlobalBlocksToService(ownerId: string, serviceId: string) {
    const referenceServiceIds =
      await this.supportService.getOtherOwnerServiceIds(ownerId, serviceId);
    if (referenceServiceIds.length === 0) {
      return;
    }

    const referenceBlocks = await this.serviceBlockRepository.find({
      where: { service_id: In(referenceServiceIds) },
    });
    if (referenceBlocks.length === 0) {
      return;
    }

    const nowTs = Date.now();
    const signatureServicesMap = new Map<string, Set<string>>();
    const signatureSampleMap = new Map<string, ServiceBlock>();

    for (const block of referenceBlocks) {
      if (new Date(block.end_time).getTime() < nowTs) {
        continue;
      }
      const signature = this.supportService.getBlockSignature(block);
      if (!signatureServicesMap.has(signature)) {
        signatureServicesMap.set(signature, new Set<string>());
      }
      signatureServicesMap.get(signature)!.add(block.service_id);
      if (!signatureSampleMap.has(signature)) {
        signatureSampleMap.set(signature, block);
      }
    }

    const targetBlocks = await this.serviceBlockRepository.find({
      where: { service_id: serviceId },
    });
    const targetSignatures = new Set(
      targetBlocks.map((block) => this.supportService.getBlockSignature(block)),
    );

    const blocksToInsert: ServiceBlock[] = [];
    for (const [signature, serviceSet] of signatureServicesMap.entries()) {
      if (serviceSet.size !== referenceServiceIds.length) {
        continue;
      }
      if (targetSignatures.has(signature)) {
        continue;
      }
      const sample = signatureSampleMap.get(signature);
      if (!sample) {
        continue;
      }

      blocksToInsert.push(
        this.serviceBlockRepository.create({
          service_id: serviceId,
          type: sample.type,
          start_time: sample.start_time,
          end_time: sample.end_time,
          reason: sample.reason,
          description: sample.description,
          notes: sample.notes,
        }),
      );
    }

    if (blocksToInsert.length === 0) {
      return;
    }

    await this.serviceBlockRepository.save(blocksToInsert);
    await this.supportService.safeInvalidateAvailability(serviceId);
  }

  async addGlobalBlock(userId: string, dto: CreateServiceBlockDto) {
    const services = await this.servicesRepository.find({
      where: { owner_id: userId, is_active: true, is_deleted: false },
      select: ['id'],
    });

    if (services.length === 0) {
      throw new NotFoundException('No active services found to apply block');
    }

    const blocks = services.map((service) =>
      this.serviceBlockRepository.create({
        ...dto,
        service_id: service.id,
      }),
    );

    const saved = await this.serviceBlockRepository.save(blocks);
    await this.supportService.invalidateServices(
      services.map((service) => service.id),
    );
    return saved;
  }

  async updateGlobalBlock(
    blockId: string,
    userId: string,
    dto: UpdateServiceBlockDto,
  ) {
    const anchor = await this.serviceBlockRepository.findOne({
      where: { id: blockId },
    });
    if (!anchor) {
      throw new NotFoundException('Block not found');
    }

    await this.supportService.assertOwnedService(anchor.service_id, userId);

    const startTime = dto.start_time
      ? new Date(dto.start_time)
      : new Date(anchor.start_time);
    const endTime = dto.end_time
      ? new Date(dto.end_time)
      : new Date(anchor.end_time);
    if (startTime.getTime() >= endTime.getTime()) {
      throw new BadRequestException('end_time must be later than start_time');
    }

    const serviceIds = await this.supportService.getOwnerServiceIds(userId);
    if (serviceIds.length === 0) {
      throw new NotFoundException('No owned services found');
    }

    const allBlocks = await this.serviceBlockRepository.find({
      where: { service_id: In(serviceIds) },
    });
    const anchorSignature = this.supportService.getBlockSignature(anchor);
    const matchedBlocks = allBlocks.filter(
      (block) =>
        this.supportService.getBlockSignature(block) === anchorSignature,
    );
    if (matchedBlocks.length === 0) {
      throw new NotFoundException('Block group not found');
    }

    for (const block of matchedBlocks) {
      if (dto.type !== undefined) {
        block.type = dto.type;
      }
      if (dto.start_time !== undefined) {
        block.start_time = new Date(dto.start_time);
      }
      if (dto.end_time !== undefined) {
        block.end_time = new Date(dto.end_time);
      }
      if (dto.reason !== undefined) {
        block.reason = dto.reason;
      }
      if (dto.description !== undefined) {
        block.description = dto.description;
      }
      if (dto.notes !== undefined) {
        block.notes = dto.notes;
      }
    }

    await this.serviceBlockRepository.save(matchedBlocks);
    await this.supportService.invalidateServices(
      matchedBlocks.map((block) => block.service_id),
    );

    return {
      updated_count: matchedBlocks.length,
    };
  }
}
