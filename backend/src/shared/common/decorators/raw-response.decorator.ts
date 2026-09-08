import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_METADATA = 'booking:raw-response';

/**
 * Marks a transport-level endpoint whose response shape is an external
 * contract and must not be changed by the generic API response envelope.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_METADATA, true);
