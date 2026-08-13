import { TelegramSessionStateService } from './telegram-session-state.service';

describe('TelegramSessionStateService', () => {
  let service: TelegramSessionStateService;

  beforeEach(() => {
    service = new TelegramSessionStateService();
  });

  it('should trim oldest pending imports when overflow', () => {
    const tokens: string[] = [];
    for (let i = 0; i < 2001; i += 1) {
      const token = service.createPendingImport({
        chatId: 1000 + i,
        userId: 2000 + i,
        content: `content-${i}`,
        source: 'text',
        ttlMs: 60_000,
      });
      tokens.push(token);
    }

    const oldest = service.takePendingImport({
      token: tokens[0],
      chatId: 1000,
      userId: 2000,
    });
    expect(oldest).toBeNull();

    const latest = service.takePendingImport({
      token: tokens[2000],
      chatId: 3000,
      userId: 4000,
    });
    expect(latest?.content).toBe('content-2000');
  });

  it('should trim oldest pending markup targets when overflow', () => {
    for (let i = 0; i < 2001; i += 1) {
      service.setPendingMarkupTarget({
        chatId: 5000 + i,
        userId: 6000 + i,
        collectionId: `node-${i}`,
        ttlMs: 60_000,
      });
    }

    const oldest = service.takePendingMarkupTarget({
      chatId: 5000,
      userId: 6000,
    });
    expect(oldest).toBeNull();

    const latest = service.takePendingMarkupTarget({
      chatId: 7000,
      userId: 8000,
    });
    expect(latest?.collectionId).toBe('node-2000');
  });
});
