import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { OrderCreationService } from './order-creation.service';
import { Order, OrderStatus } from '../entities/order.entity';
import { OrderValidator } from '../utils/order-validator';
import type { OrderServicesPort } from '../ports/order-services.port';
import { OrderSourceResolverService } from './order-source-resolver.service';
import { OrderFinancialService } from './order-financial.service';
import { OrderOutboxService } from '../outbox/order-outbox.service';

describe('OrderCreationService source idempotency', () => {
  const command = {
    consumer_id: 'consumer-1',
    service_id: 'service-1',
    start_time: '2026-09-10T02:00:00.000Z',
    end_time: '2026-09-10T03:00:00.000Z',
    source_idempotency_key: 'telegram:42:update:1001',
  };
  const serviceSnapshot = {
    id: 'service-1',
    owner_id: 'owner-1',
    is_active: true,
    title: 'Consultation',
    duration_minutes: 60,
    base_price: 100,
    provider_base_price: 80,
    deposit_points: 10,
  };
  const existingOrder = {
    id: 'order-existing',
    order_no: 'O-existing',
    source_idempotency_key: command.source_idempotency_key,
    consumer_id: 'consumer-1',
    owner_id: 'owner-1',
    service_id: 'service-1',
    agency_node_id: null,
    start_time: new Date(command.start_time),
    end_time: new Date(command.end_time),
    status: OrderStatus.RESERVED,
    frozen_points: 10,
    display_price_snapshot: 100,
    service_snapshot: { base_price: 100 },
  } as Order;

  const servicesPort = {
    findServiceById: jest.fn().mockResolvedValue(serviceSnapshot),
  } as unknown as OrderServicesPort;
  const sourceResolver = {
    resolve: jest
      .fn()
      .mockResolvedValue({ displayPrice: 100, agencyNodeId: null }),
  } as unknown as OrderSourceResolverService;
  const financial = {
    freezeDepositCredit: jest.fn().mockResolvedValue(undefined),
  } as unknown as OrderFinancialService;
  const orderOutbox = {
    enqueueOrderCreated: jest.fn().mockResolvedValue({ id: 'event-1' }),
    dispatchOrderCreatedBestEffort: jest.fn().mockResolvedValue(undefined),
  } as unknown as OrderOutboxService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(OrderValidator, 'validateSchedule').mockImplementation(() => {});
    jest
      .spyOn(OrderValidator, 'checkTimeSlotAvailability')
      .mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  function buildSubject(params: {
    preliminary?: Order | null;
    insideTransaction?: Order | null;
    saveError?: Error;
    raceWinner?: Order | null;
  }) {
    const findOne = jest.fn().mockResolvedValueOnce(params.preliminary ?? null);
    if (params.raceWinner !== undefined) {
      findOne.mockResolvedValueOnce(params.raceWinner);
    }

    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(params.insideTransaction ?? null),
      save: params.saveError
        ? jest.fn().mockRejectedValue(params.saveError)
        : jest.fn().mockResolvedValue(existingOrder),
    };
    const queryRunner = {
      manager,
      isTransactionActive: false,
      connect: jest.fn(),
      startTransaction: jest.fn(function (this: typeof queryRunner) {
        this.isTransactionActive = true;
      }),
      commitTransaction: jest.fn(function (this: typeof queryRunner) {
        this.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn(function (this: typeof queryRunner) {
        this.isTransactionActive = false;
      }),
      release: jest.fn(),
      query: jest.fn(),
    };
    const repository = {
      findOne,
      create: jest.fn((draft: Partial<Order>) => draft as Order),
    } as unknown as Repository<Order>;
    const dataSource = {
      options: { type: 'postgres' },
      createQueryRunner: jest.fn(() => queryRunner),
    } as unknown as DataSource;

    return {
      subject: new OrderCreationService(
        repository,
        servicesPort,
        sourceResolver,
        dataSource,
        orderOutbox,
        financial,
      ),
      manager,
      queryRunner,
      repository,
    };
  }

  it('returns a committed existing order before resolving service or freezing credit', async () => {
    const { subject } = buildSubject({ preliminary: existingOrder });

    await expect(subject.create(command)).resolves.toBe(existingOrder);
    expect(servicesPort.findServiceById).not.toHaveBeenCalled();
    expect(financial.freezeDepositCredit).not.toHaveBeenCalled();
    expect(orderOutbox.dispatchOrderCreatedBestEffort).toHaveBeenCalledWith(
      existingOrder.id,
    );
  });

  it.each([
    ['consumer', { consumer_id: 'different-consumer' }],
    ['service', { service_id: 'different-service' }],
    ['agency', { agency_node_id: 'different-agency' }],
    ['start time', { start_time: '2026-09-10T02:30:00.000Z' }],
    ['end time', { end_time: '2026-09-10T03:30:00.000Z' }],
  ])(
    'fails closed when the same key is replayed with a different %s',
    async (_label, change) => {
      const { subject } = buildSubject({ preliminary: existingOrder });

      await expect(
        subject.create({ ...command, ...change }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(servicesPort.findServiceById).not.toHaveBeenCalled();
      expect(financial.freezeDepositCredit).not.toHaveBeenCalled();
    },
  );

  it('serializes by source key and rechecks it inside the transaction', async () => {
    const { subject, queryRunner } = buildSubject({
      insideTransaction: existingOrder,
    });

    await expect(subject.create(command)).resolves.toBe(existingOrder);
    expect(queryRunner.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`order_idempotency:${command.source_idempotency_key}`],
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(financial.freezeDepositCredit).not.toHaveBeenCalled();
    expect(orderOutbox.enqueueOrderCreated).not.toHaveBeenCalled();
  });

  it('returns the race winner after a unique insert conflict rolls back local effects', async () => {
    const { subject, queryRunner } = buildSubject({
      saveError: new Error('unique violation'),
      raceWinner: existingOrder,
    });

    await expect(subject.create(command)).resolves.toBe(existingOrder);
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(orderOutbox.enqueueOrderCreated).not.toHaveBeenCalled();
  });

  it('persists the key and emits creation only for the winning order', async () => {
    const { subject, repository, queryRunner } = buildSubject({});

    await expect(subject.create(command)).resolves.toBe(existingOrder);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source_idempotency_key: command.source_idempotency_key,
      }),
    );
    expect(financial.freezeDepositCredit).toHaveBeenCalledTimes(1);
    expect(orderOutbox.enqueueOrderCreated).toHaveBeenCalledTimes(1);
    expect(orderOutbox.dispatchOrderCreatedBestEffort).toHaveBeenCalledTimes(1);
    expect(
      (orderOutbox.enqueueOrderCreated as jest.Mock).mock
        .invocationCallOrder[0],
    ).toBeLessThan(queryRunner.commitTransaction.mock.invocationCallOrder[0]);
  });

  it('rolls back the order and credit transaction when outbox persistence fails', async () => {
    const { subject, queryRunner } = buildSubject({});
    (orderOutbox.enqueueOrderCreated as jest.Mock).mockRejectedValueOnce(
      new Error('outbox unavailable'),
    );

    await expect(subject.create(command)).rejects.toThrow('outbox unavailable');
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(orderOutbox.dispatchOrderCreatedBestEffort).not.toHaveBeenCalled();
  });

  it('creates and freezes exactly once when two calls overlap', async () => {
    let committedOrder: Order | null = null;
    let preliminaryReaders = 0;
    let releasePreliminaryReaders!: () => void;
    const preliminaryBarrier = new Promise<void>((resolve) => {
      releasePreliminaryReaders = resolve;
    });
    const repository = {
      findOne: jest.fn(async () => {
        preliminaryReaders += 1;
        if (preliminaryReaders === 2) releasePreliminaryReaders();
        await preliminaryBarrier;
        return null;
      }),
      create: jest.fn((draft: Partial<Order>) => draft as Order),
    } as unknown as Repository<Order>;

    let lockTail = Promise.resolve();
    let saveCount = 0;
    const buildRunner = () => {
      let releaseKeyLock: (() => void) | undefined;
      let pendingOrder: Order | null = null;
      const runner = {
        isTransactionActive: false,
        connect: jest.fn(),
        startTransaction: jest.fn(() => {
          runner.isTransactionActive = true;
        }),
        query: jest.fn(async (_sql: string, args?: string[]) => {
          if (!args?.[0]?.startsWith('order_idempotency:')) return;
          const predecessor = lockTail;
          lockTail = new Promise<void>((resolve) => {
            releaseKeyLock = resolve;
          });
          await predecessor;
        }),
        manager: {
          findOne: jest.fn(async (_entity: unknown, options: any) => {
            if (options?.where?.source_idempotency_key) return committedOrder;
            return null;
          }),
          save: jest.fn(async (_entity: unknown, order: Order) => {
            saveCount += 1;
            pendingOrder = {
              ...order,
              id: 'order-winner',
              order_no: 'O-winner',
            };
            return pendingOrder;
          }),
        },
        commitTransaction: jest.fn(async () => {
          if (pendingOrder) committedOrder = pendingOrder;
          runner.isTransactionActive = false;
          releaseKeyLock?.();
        }),
        rollbackTransaction: jest.fn(async () => {
          runner.isTransactionActive = false;
          releaseKeyLock?.();
        }),
        release: jest.fn(),
      };
      return runner;
    };
    const dataSource = {
      options: { type: 'postgres' },
      createQueryRunner: jest.fn(buildRunner),
    } as unknown as DataSource;
    const subject = new OrderCreationService(
      repository,
      servicesPort,
      sourceResolver,
      dataSource,
      orderOutbox,
      financial,
    );

    const [first, second] = await Promise.all([
      subject.create(command),
      subject.create(command),
    ]);

    expect(first.id).toBe('order-winner');
    expect(second.id).toBe('order-winner');
    expect(saveCount).toBe(1);
    expect(financial.freezeDepositCredit).toHaveBeenCalledTimes(1);
    expect(orderOutbox.enqueueOrderCreated).toHaveBeenCalledTimes(1);
    expect(orderOutbox.dispatchOrderCreatedBestEffort).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed trusted-source keys before any lookup', async () => {
    const { subject } = buildSubject({});

    await expect(
      subject.create({ ...command, source_idempotency_key: ' padded ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
