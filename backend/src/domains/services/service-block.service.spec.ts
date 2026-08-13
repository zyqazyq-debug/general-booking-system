import { Test, TestingModule } from '@nestjs/testing';
import { ServiceBlockService } from './service-block.service';
import { ServiceBlockSingleService } from './services/service-block-single.service';
import { ServiceBlockGlobalService } from './services/service-block-global.service';
import { ServiceBlockMaintenanceService } from './services/service-block-maintenance.service';
import { ServiceBlockQueryService } from './services/service-block-query.service';
import { ServiceBlockRemovalService } from './services/service-block-removal.service';

describe('ServiceBlockService', () => {
  let service: ServiceBlockService;

  const singleService = {
    addBlock: jest.fn(),
    removeBlock: jest.fn(),
  };

  const globalService = {
    applyInferredGlobalBlocksToService: jest.fn(),
    addGlobalBlock: jest.fn(),
    updateGlobalBlock: jest.fn(),
  };

  const maintenanceService = {
    cleanupExpiredBlocks: jest.fn(),
  };

  const queryService = {
    getGlobalBlocks: jest.fn(),
  };

  const removalService = {
    removeGlobalBlock: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceBlockService,
        { provide: ServiceBlockSingleService, useValue: singleService },
        { provide: ServiceBlockGlobalService, useValue: globalService },
        {
          provide: ServiceBlockMaintenanceService,
          useValue: maintenanceService,
        },
        { provide: ServiceBlockQueryService, useValue: queryService },
        { provide: ServiceBlockRemovalService, useValue: removalService },
      ],
    }).compile();

    service = module.get<ServiceBlockService>(ServiceBlockService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates single-service block mutation', async () => {
    const dto = {
      type: 'TIME_OFF',
      start_time: '2026-03-28T10:00:00.000Z',
      end_time: '2026-03-28T12:00:00.000Z',
    };
    singleService.addBlock.mockResolvedValue({ id: 'block-1' });

    await expect(
      service.addBlock('svc-1', 'user-1', dto as never),
    ).resolves.toEqual({ id: 'block-1' });
    expect(singleService.addBlock).toHaveBeenCalledWith('svc-1', 'user-1', dto);
  });

  it('delegates global block workflows', async () => {
    globalService.addGlobalBlock.mockResolvedValue([{ id: 'block-1' }]);
    globalService.updateGlobalBlock.mockResolvedValue({ updated_count: 2 });

    await expect(
      service.addGlobalBlock('user-1', {
        type: 'TIME_OFF',
        start_time: '2026-03-28T10:00:00.000Z',
        end_time: '2026-03-28T12:00:00.000Z',
      } as never),
    ).resolves.toEqual([{ id: 'block-1' }]);
    await expect(
      service.updateGlobalBlock('block-1', 'user-1', {
        reason: 'vacation',
      } as never),
    ).resolves.toEqual({ updated_count: 2 });
  });

  it('delegates maintenance, query and removal flows', async () => {
    maintenanceService.cleanupExpiredBlocks.mockResolvedValue(3);
    queryService.getGlobalBlocks.mockResolvedValue([{ id: 'group-1' }]);
    removalService.removeGlobalBlock.mockResolvedValue({ deleted_count: 2 });
    singleService.removeBlock.mockResolvedValue({ affected: 1 });

    await expect(service.cleanupExpiredBlocks()).resolves.toBe(3);
    await expect(service.getGlobalBlocks('user-1')).resolves.toEqual([
      { id: 'group-1' },
    ]);
    await expect(
      service.removeGlobalBlock('block-1', 'user-1'),
    ).resolves.toEqual({ deleted_count: 2 });
    await expect(service.removeBlock('block-2', 'user-1')).resolves.toEqual({
      affected: 1,
    });
  });
});
