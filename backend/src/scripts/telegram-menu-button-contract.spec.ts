import {
  planPreprodMenuButton,
  planPreprodMenuButtonRollback,
  PREPROD_MENU_BUTTON,
} from './telegram-menu-button-contract';

describe('preproduction Telegram chat menu button contract', () => {
  it('plans the one fixed preproduction web app URL and is idempotent', () => {
    const change = planPreprodMenuButton('preproduction', { type: 'commands' });
    expect(change).toEqual({
      schemaVersion: 1,
      environment: 'preproduction',
      before: { type: 'commands' },
      desired: PREPROD_MENU_BUTTON,
      mutationRequired: true,
    });
    expect(
      planPreprodMenuButton('preproduction', PREPROD_MENU_BUTTON)
        .mutationRequired,
    ).toBe(false);
  });

  it('cannot be extended to production by arguments', () => {
    expect(() =>
      planPreprodMenuButton('production', { type: 'default' }),
    ).toThrow('PREPROD_MENU_BUTTON_SCOPE_REQUIRED');
  });

  it('only rolls back while the current value still equals this plan desired value', () => {
    const plan = planPreprodMenuButton('preproduction', {
      type: 'web_app',
      text: 'Previous',
      web_app: { url: 'https://previous.example/' },
    });
    expect(planPreprodMenuButtonRollback(plan, PREPROD_MENU_BUTTON)).toEqual({
      restore: {
        type: 'web_app',
        text: 'Previous',
        web_app: { url: 'https://previous.example/' },
      },
      mutationRequired: true,
    });
    expect(() =>
      planPreprodMenuButtonRollback(plan, { type: 'commands' }),
    ).toThrow('MENU_BUTTON_ROLLBACK_OWNERSHIP_LOST');
  });

  it('rejects malformed or secret-bearing menu values rather than preserving them', () => {
    expect(() =>
      planPreprodMenuButton('preproduction', {
        type: 'web_app',
        text: 'Bad',
        web_app: { url: 'https://user:secret@example.test/' },
      }),
    ).toThrow('INVALID_MENU_BUTTON');
    expect(() =>
      planPreprodMenuButton('preproduction', {
        type: 'commands',
        unexpected: 'value',
      }),
    ).toThrow('INVALID_MENU_BUTTON');
  });
});
