import { ForbiddenException, ValidationPipe } from '@nestjs/common';

import { CreateServiceDto } from './dto/create-service.dto';
import { ZCreateServiceSchema } from './dto/create-service.schema';
import { ServicesController } from './services.controller';

describe('ServicesController P0 boundaries', () => {
  const servicesService = {
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getPublicAvailability: jest.fn(),
    getManagementAvailability: jest.fn(),
  };
  const agencyPort = {
    findNodeById: jest.fn(),
  };
  const availabilityService = {
    getAvailableSlots: jest.fn(),
  };

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

  it('rejects a client-supplied owner_id before creation and derives ownership from the JWT', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    await expect(
      pipe.transform(
        {
          title: 'Consultation',
          base_price: 100,
          deposit_points: 10,
          owner_id: 'attacker-owner',
        },
        { type: 'body', metatype: CreateServiceDto },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.arrayContaining([
          expect.stringContaining('owner_id should not exist'),
        ]),
      }),
    });

    expect(
      ZCreateServiceSchema.safeParse({
        title: 'Consultation',
        base_price: 100,
        deposit_points: 10,
        owner_id: 'attacker-owner',
      }).success,
    ).toBe(false);

    await controller.create(
      {
        title: 'Consultation',
        base_price: 100,
        deposit_points: 10,
        owner_id: 'attacker-owner',
      } as never,
      {
        user: { id: 'authenticated-owner', roles: ['USER'] },
      } as never,
    );

    expect(servicesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Consultation',
        owner_id: 'authenticated-owner',
      }),
    );
  });

  it('accepts only object-shaped public service metadata', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const basePayload = {
      title: 'Consultation',
      base_price: 100,
      deposit_points: 10,
    };

    await expect(
      pipe.transform(
        {
          ...basePayload,
          metadata: { source: 'provider', flags: { vip: true } },
        },
        { type: 'body', metatype: CreateServiceDto },
      ),
    ).resolves.toMatchObject({ metadata: { source: 'provider' } });

    for (const metadata of [[], ['tag'], 'tag', 1, true, null]) {
      await expect(
        pipe.transform(
          { ...basePayload, metadata },
          { type: 'body', metatype: CreateServiceDto },
        ),
      ).rejects.toBeDefined();
      expect(
        ZCreateServiceSchema.safeParse({ ...basePayload, metadata }).success,
      ).toBe(false);
    }

    expect(
      ZCreateServiceSchema.safeParse({
        ...basePayload,
        metadata: { source: 'provider', flags: { vip: true } },
      }).success,
    ).toBe(true);
  });

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

  it.each([
    [
      'slots',
      () => controller.getAvailableSlots('service-1', '2030-01-01', 'node-1'),
    ],
    [
      'available-slots',
      () =>
        controller.getAvailableSlotsAlias('service-1', '2030-01-01', 'node-1'),
    ],
  ])(
    'never serializes agency node details through the public %s path',
    async (_name, act) => {
      agencyPort.findNodeById.mockResolvedValue({
        id: 'node-1',
        service_id: 'service-1',
        private_notes: 'provider-only node note',
        markup_value: 99,
      });
      availabilityService.getAvailableSlots.mockResolvedValue([
        {
          start_time: '2030-01-01T09:00:00.000Z',
          end_time: '2030-01-01T10:00:00.000Z',
          status: 'available',
        },
      ]);

      const result = await act();

      expect(result).toEqual([
        {
          start_time: '2030-01-01T09:00:00.000Z',
          end_time: '2030-01-01T10:00:00.000Z',
          status: 'available',
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('provider-only node note');
      expect(JSON.stringify(result)).not.toContain('markup_value');
    },
  );
});

const adminRequest = {
  user: {
    id: 'admin-b',
    roles: ['ADMIN'],
  },
} as never;
