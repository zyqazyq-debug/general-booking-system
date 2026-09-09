import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import { Context } from 'telegraf';
import { telegrafLoggerMiddleware } from './logger.middleware';

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
}));

describe('telegrafLoggerMiddleware', () => {
  it('never writes handler error text or update content to traffic logs', async () => {
    const sensitive = 'secret-token-and-private-update-text';
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const ctx = {
      updateType: 'message',
      update: { message: { text: sensitive } },
    } as unknown as Context;

    await expect(
      telegrafLoggerMiddleware(ctx, async () => {
        throw new Error(sensitive);
      }),
    ).rejects.toThrow(sensitive);

    const writes = JSON.stringify((fs.appendFileSync as jest.Mock).mock.calls);
    const logs = JSON.stringify(errorLog.mock.calls);
    expect(writes).toContain('error_type=Error');
    expect(writes).not.toContain(sensitive);
    expect(logs).not.toContain(sensitive);
    errorLog.mockRestore();
  });
});
