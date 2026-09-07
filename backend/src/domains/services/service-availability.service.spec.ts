import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import { DataSource } from 'typeorm';

import { ServiceAvailabilityService } from './service-availability.service';
import { Service } from './entities/service.entity';
import { ServiceBlock } from './entities/service-block.entity';

describe('ServiceAvailabilityService', () => {
  let service: ServiceAvailabilityService;

  const servicesRepository = {
    findOne: jest.fn(),
  };
  const orderRepository = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const serviceBlockRepository = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const cacheManager: Partial<Cache> = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const dataSource: Partial<DataSource> = {
      getRepository: jest.fn().mockReturnValue(orderRepository),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceAvailabilityService,
        {
          provide: getRepositoryToken(Service),
          useValue: servicesRepository,
        },
        {
          provide: getRepositoryToken(ServiceBlock),
          useValue: serviceBlockRepository,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
      ],
    }).compile();

    service = module.get<ServiceAvailabilityService>(
      ServiceAvailabilityService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockCacheGet = (key: string) => {
    if (key.startsWith('service_version:')) return 1;
    return null;
  };

  describe('getAvailableSlots', () => {
    it('should throw NotFoundException when service missing', async () => {
      (cacheManager.get as jest.Mock).mockImplementation(mockCacheGet);
      servicesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getAvailableSlots('service-1', '2026-03-24'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should throw BadRequestException with error_code when service inactive', async () => {
      (cacheManager.get as jest.Mock).mockImplementation(mockCacheGet);
      servicesRepository.findOne.mockResolvedValue({
        id: 'service-1',
        is_deleted: false,
        is_active: false,
      });

      try {
        await service.getAvailableSlots('service-1', '2026-03-24');
        throw new Error('Expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getStatus()).toBe(400);
        expect((e as BadRequestException).getResponse()).toMatchObject({
          error_code: 'SERVICE_UNAVAILABLE',
        });
      }

      expect(orderRepository.find).not.toHaveBeenCalled();
      expect(serviceBlockRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('getAvailability', () => {
    it('should throw BadRequestException with error_code when service deleted', async () => {
      (cacheManager.get as jest.Mock).mockImplementation(mockCacheGet);
      servicesRepository.findOne.mockResolvedValue({
        id: 'service-1',
        is_deleted: true,
        is_active: true,
        owner_id: 'owner-1',
        owner: { id: 'owner-1' },
      });

      try {
        await service.getAvailability('service-1', '2026-03-01', '2026-03-31');
        throw new Error('Expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getStatus()).toBe(400);
        expect((e as BadRequestException).getResponse()).toMatchObject({
          error_code: 'SERVICE_UNAVAILABLE',
        });
      }
    });

    it('removes all block annotations from the public projection', async () => {
      jest.spyOn(service, 'getAvailability').mockResolvedValue({
        rules: {
          weekdays: [1, 2, 3, 4, 5],
          start_hour: 9,
          end_hour: 18,
          duration_minutes: 60,
          buffer_minutes: 15,
        },
        busy_slots: [
          {
            start: new Date('2030-01-01T09:00:00.000Z'),
            end: '2030-01-01T10:15:00.000Z',
          },
        ],
        blocks: [
          {
            id: 'block-1',
            start: new Date('2030-01-01T12:00:00.000Z'),
            end: new Date('2030-01-01T13:00:00.000Z'),
            type: 'TIME_OFF',
            reason: 'private reason',
            description: 'private description',
            notes: 'provider-only note',
          },
        ],
      } as never);

      const result = await service.getPublicAvailability(
        'service-1',
        '2030-01-01',
        '2030-01-01',
      );

      expect(result).toEqual({
        rules: {
          weekdays: [1, 2, 3, 4, 5],
          start_hour: 9,
          end_hour: 18,
          duration_minutes: 60,
          buffer_minutes: 15,
        },
        busy_slots: [
          {
            start: '2030-01-01T09:00:00.000Z',
            end: '2030-01-01T10:15:00.000Z',
          },
        ],
        blocks: [
          {
            start: '2030-01-01T12:00:00.000Z',
            end: '2030-01-01T13:00:00.000Z',
          },
        ],
      });
      expect(JSON.stringify(result)).not.toContain('provider-only note');
      expect(JSON.stringify(result)).not.toContain('private reason');
      expect(JSON.stringify(result)).not.toContain('private description');
      expect(JSON.stringify(result)).not.toContain('block-1');
    });
  });
});
