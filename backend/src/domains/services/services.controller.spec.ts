import { ForbiddenException } from '@nestjs/common';

import { ServicesController } from './services.controller';

describe('ServicesController P0 boundaries', () => {
  const servicesService = {
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getPublicAvailability: jest.fn(),
    getManagementAvailability: jest.fn(),
  };
  const agencyPort = {};
  const availabilityService = {};

  let controller: ServicesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ServicesController(
      servicesService as never,
      agencyPort as never,
      availabilityService as never,
    );
  });

  it.each([
    ['update', () => controller.update('service-1', {} as never, adminRequest)],
    ['delete', () => controller.remove('service-1', adminRequest)],
  ])(
    'does not let an admin %s another provider service',
    async (_name, act) => {
      servicesService.findOne.mockResolvedValue({
        id: 'service-1',
        owner_id: 'owner-a',
      });

      await expect(act()).rejects.toBeInstanceOf(ForbiddenException);
      expect(servicesService.update).not.toHaveBeenCalled();
      expect(servicesService.remove).not.toHaveBeenCalled();
    },
  );

  it('uses the public availability projection for the anonymous endpoint', async () => {
    const publicResponse = {
      rules: { weekdays: [1], start_hour: 9, end_hour: 18 },
      busy_slots: [],
      blocks: [
        { start: '2030-01-01T10:00:00.000Z', end: '2030-01-01T11:00:00.000Z' },
      ],
    };
    servicesService.getPublicAvailability.mockResolvedValue(publicResponse);

    await expect(
      controller.getAvailability('service-1', '2030-01-01', '2030-01-01'),
    ).resolves.toEqual(publicResponse);
    expect(servicesService.getPublicAvailability).toHaveBeenCalledWith(
      'service-1',
      '2030-01-01',
      '2030-01-01',
    );
    expect(servicesService.getManagementAvailability).not.toHaveBeenCalled();
  });

  it('only returns management availability to the service owner', async () => {
    servicesService.findOne.mockResolvedValue({
      id: 'service-1',
      owner_id: 'owner-a',
    });

    await expect(
      controller.getManagementAvailability(
        'service-1',
        '2030-01-01',
        '2030-01-01',
        adminRequest,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(servicesService.getManagementAvailability).not.toHaveBeenCalled();
  });
});

const adminRequest = {
  user: {
    id: 'admin-b',
    roles: ['ADMIN'],
  },
} as never;
