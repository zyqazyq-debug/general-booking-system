import { ContractError, EXIT } from './contracts.mjs';

export const LEGACY_EXTERNAL_ACTIONS = Object.freeze([
  'preprod-baseline-ledger',
  'preprod-expand-migrate',
  'preprod-prepare-telegram-egress',
  'preprod-probe-candidate',
  'preprod-probe-active',
  'preprod-probe-observation',
  'preprod-probe-rollback',
  'preprod-transfer-singletons',
  'preprod-set-webhook',
  'preprod-rollback-singletons',
]);

export const LOCAL_INGRESS_EXTERNAL_ACTIONS = Object.freeze([
  'preprod-switch-ingress',
  'preprod-rollback-ingress',
]);

export const RECOVERY_EXTERNAL_ACTIONS = Object.freeze([
  'preprod-abort-telegram-egress',
  'preprod-attest-database-restore',
  'preprod-restore-active-runtime',
  'preprod-probe-recovered-active',
]);

const LEGACY = new Set(LEGACY_EXTERNAL_ACTIONS);
const RECOVERY = new Set(RECOVERY_EXTERNAL_ACTIONS);
const LOCAL_INGRESS = new Set(LOCAL_INGRESS_EXTERNAL_ACTIONS);
const STAGE = new Set(['preprod-stage']);

/**
 * External-action versions are selected by the immutable action name.  This
 * keeps v1 frozen while allowing recovery-only actions to use v2, and gives
 * every request reconstruction and receipt validation one source of truth.
 */
export function schemaForAction(action) {
  if (STAGE.has(action)) {
    return Object.freeze({
      request: 'booking.fenced-action-request/v4',
      receipt: 'booking.external-action-receipt/v4',
    });
  }
  if (LEGACY.has(action)) {
    return Object.freeze({
      request: 'booking.fenced-action-request/v1',
      receipt: 'booking.external-action-receipt/v1',
    });
  }
  if (RECOVERY.has(action)) {
    return Object.freeze({
      request: 'booking.fenced-action-request/v2',
      receipt: 'booking.external-action-receipt/v2',
    });
  }
  if (LOCAL_INGRESS.has(action)) {
    return Object.freeze({
      request: 'booking.fenced-action-request/v3',
      receipt: 'booking.external-action-receipt/v3',
    });
  }
  throw new ContractError(`unsupported external action contract: ${action}`, EXIT.IDENTITY);
}
