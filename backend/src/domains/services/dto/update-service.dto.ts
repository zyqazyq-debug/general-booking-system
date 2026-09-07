import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateServiceDto } from './create-service.dto';

export class UpdateServiceDto extends PartialType(
  OmitType(CreateServiceDto, ['owner_id'] as const),
) {}
