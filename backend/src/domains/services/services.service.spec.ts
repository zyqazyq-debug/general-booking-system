import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { UpdateServiceDto } from './dto/update-service.dto';
import { ServicesService } from './services.service';

describe('ServicesService ownership invariants', () => {
  const servicesRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const serviceBlockService = {};
  const availabilityService = {
    invalidateCache: jest.fn(),
  };
  const agencyPort = {
    propagateScheduleUpdate: jest.fn(),
  };

  let service: ServicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ServicesService(
      servicesRepository as never,
      serviceBlockService as never,
      availabilityService as never,
      agencyPort as never,
    );
  });

  it('strips owner_id from the HTTP update DTO', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });

    const transformed = await pipe.transform(
      { title: 'Updated', owner_id: 'owner-b' },
      { type: 'body', metatype: UpdateServiceDto },
    );

    expect(transformed).toEqual(expect.objectContaining({ title: 'Updated' }));
    expect(transformed).not.toHaveProperty('owner_id');
  });

  it('rejects owner_id injection through the ordinary update use case', async () => {
    servicesRepository.findOne.mockResolvedValue({
      id: 'service-1',
      owner_id: 'owner-a',
      title: 'Original',
      is_active: true,
      is_deleted: false,
    });

    await expect(
      service.update('service-1', {
        title: 'Injected',
        owner_id: 'owner-b',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(servicesRepository.save).not.toHaveBeenCalled();
    expect(agencyPort.propagateScheduleUpdate).not.toHaveBeenCalled();
    expect(availabilityService.invalidateCache).not.toHaveBeenCalled();
  });

  it('preserves owner_id during an ordinary field update', async () => {
    const stored = {
      id: 'service-1',
      owner_id: 'owner-a',
      title: 'Original',
      is_active: true,
      is_deleted: false,
    };
    servicesRepository.findOne.mockResolvedValue(stored);
    servicesRepository.save.mockImplementation(async (value) => value);

    await expect(
      service.update('service-1', { title: 'Updated' } as never),
    ).resolves.toMatchObject({
      owner_id: 'owner-a',
      title: 'Updated',
    });
  });
});
