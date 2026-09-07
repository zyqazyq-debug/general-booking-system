import type { CreateServiceDto } from '../dto/create-service.dto';

/**
 * Internal command assembled at the HTTP boundary after authentication.
 * `owner_id` is deliberately absent from the public transport DTO.
 */
export type CreateServiceCommand = CreateServiceDto & {
  owner_id: string;
};
