import { ServiceUnavailableException } from '@nestjs/common';
import { OpsStatusController } from './ops-status.controller';

describe('OpsStatusController', () => {
  const config = (values: Record<string, string>) => ({
    get: jest.fn((key: string) => values[key]),
  });

  it('reports process liveness without an infrastructure dependency', () => {
    const controller = new OpsStatusController(
      config({}) as any,
      { isInitialized: false } as any,
    );
    expect(controller.live()).toEqual({ status: 'live' });
  });

  it('requires an initialized database for readiness', async () => {
    const controller = new OpsStatusController(
      config({}) as any,
      { isInitialized: false } as any,
    );
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns only non-secret release identity fields', () => {
    const controller = new OpsStatusController(
      config({
        BOOKING_RELEASE_ID: 'booking-test',
        BOOKING_GIT_SHA: 'abc123',
        BOOKING_MANIFEST_DIGEST: 'sha256:manifest',
        BOOKING_SLOT: 'green',
      }) as any,
      { isInitialized: true, query: jest.fn() } as any,
    );
    expect(controller.version()).toEqual({
      releaseId: 'booking-test',
      gitSha: 'abc123',
      manifestDigest: 'sha256:manifest',
      slot: 'green',
    });
  });
});
