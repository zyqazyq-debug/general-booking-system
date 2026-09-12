export type TelegramMenuButton =
  | { type: 'default' }
  | { type: 'commands' }
  | { type: 'web_app'; text: string; web_app: { url: string } };

export type TelegramMenuButtonPlan = {
  schemaVersion: 1;
  environment: 'preproduction';
  before: TelegramMenuButton;
  desired: {
    type: 'web_app';
    text: 'Open App';
    web_app: { url: 'https://booking-preprod.happybooking.uk/' };
  };
  mutationRequired: boolean;
};

export class TelegramMenuButtonContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'TelegramMenuButtonContractError';
  }
}

export const PREPROD_MENU_BUTTON = Object.freeze({
  type: 'web_app' as const,
  text: 'Open App' as const,
  web_app: Object.freeze({
    url: 'https://booking-preprod.happybooking.uk/' as const,
  }),
});

function exactKeys(value: object, keys: string[]): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}

export function normalizeTelegramMenuButton(
  value: unknown,
): TelegramMenuButton {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TelegramMenuButtonContractError('INVALID_MENU_BUTTON');
  }
  const record = value as Record<string, unknown>;
  if (
    (record.type === 'default' || record.type === 'commands') &&
    exactKeys(record, ['type'])
  ) {
    return { type: record.type };
  }
  if (
    record.type !== 'web_app' ||
    !exactKeys(record, ['type', 'text', 'web_app']) ||
    typeof record.text !== 'string' ||
    record.text.length < 1 ||
    record.text.length > 64 ||
    !record.web_app ||
    typeof record.web_app !== 'object' ||
    Array.isArray(record.web_app) ||
    !exactKeys(record.web_app, ['url'])
  ) {
    throw new TelegramMenuButtonContractError('INVALID_MENU_BUTTON');
  }
  const urlValue = (record.web_app as Record<string, unknown>).url;
  if (typeof urlValue !== 'string') {
    throw new TelegramMenuButtonContractError('INVALID_MENU_BUTTON');
  }
  try {
    const url = new URL(urlValue);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.toString() !== urlValue
    ) {
      throw new Error('invalid');
    }
  } catch {
    throw new TelegramMenuButtonContractError('INVALID_MENU_BUTTON');
  }
  return { type: 'web_app', text: record.text, web_app: { url: urlValue } };
}

function sameButton(
  left: TelegramMenuButton,
  right: TelegramMenuButton,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function planPreprodMenuButton(
  environment: string,
  current: unknown,
): TelegramMenuButtonPlan {
  if (environment !== 'preproduction') {
    throw new TelegramMenuButtonContractError(
      'PREPROD_MENU_BUTTON_SCOPE_REQUIRED',
    );
  }
  const before = normalizeTelegramMenuButton(current);
  const desired = {
    type: PREPROD_MENU_BUTTON.type,
    text: PREPROD_MENU_BUTTON.text,
    web_app: { url: PREPROD_MENU_BUTTON.web_app.url },
  } as TelegramMenuButtonPlan['desired'];
  return {
    schemaVersion: 1,
    environment: 'preproduction',
    before,
    desired,
    mutationRequired: !sameButton(before, desired),
  };
}

export function planPreprodMenuButtonRollback(
  plan: TelegramMenuButtonPlan,
  current: unknown,
): { restore: TelegramMenuButton; mutationRequired: boolean } {
  let normalizedBefore: TelegramMenuButton;
  try {
    normalizedBefore = normalizeTelegramMenuButton(plan?.before);
  } catch {
    throw new TelegramMenuButtonContractError('INVALID_MENU_BUTTON_PLAN');
  }
  if (
    !plan ||
    plan.schemaVersion !== 1 ||
    plan.environment !== 'preproduction' ||
    JSON.stringify(plan.desired) !== JSON.stringify(PREPROD_MENU_BUTTON) ||
    JSON.stringify(normalizedBefore) !== JSON.stringify(plan.before) ||
    plan.mutationRequired !== !sameButton(normalizedBefore, plan.desired)
  ) {
    throw new TelegramMenuButtonContractError('INVALID_MENU_BUTTON_PLAN');
  }
  const observed = normalizeTelegramMenuButton(current);
  if (!sameButton(observed, plan.desired)) {
    throw new TelegramMenuButtonContractError(
      'MENU_BUTTON_ROLLBACK_OWNERSHIP_LOST',
    );
  }
  return {
    restore: normalizedBefore,
    mutationRequired: !sameButton(normalizedBefore, plan.desired),
  };
}
