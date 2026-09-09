import { TelegramChannel } from './telegram.channel';

describe('TelegramChannel', () => {
  it('conservatively maps an unhandled adapter exception to uncertain', async () => {
    const subject = new TelegramChannel({
      send: jest.fn().mockRejectedValue(new Error('private payload')),
    });
    const logger = (subject as unknown as { logger: { error: jest.Mock } })
      .logger;
    jest.spyOn(logger, 'error');

    await expect(subject.send('private-chat', 'private-body')).resolves.toEqual(
      {
        outcome: 'uncertain',
        errorType: 'ChannelUnhandledError',
      },
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private');
  });
});
