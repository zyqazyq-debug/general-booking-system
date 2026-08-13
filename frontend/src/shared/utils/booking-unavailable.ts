export interface BookingUnavailableInput {
  error: any;
}

export interface BookingUnavailableResult {
  matched: boolean;
  statusCode: number;
  requestUrl: string;
  errorCode: string;
  rawMessage: string;
  userMessage: string;
}

const UNAVAILABLE_CODES = new Set([
  'SERVICE_UNAVAILABLE',
  'SERVICE_INACTIVE',
  'SERVICE_OFFLINE',
]);

const UNAVAILABLE_PATTERNS = [
  /service\s+is\s+currently\s+unavailable/i,
  /service\s+unavailable/i,
  /服务.*下架/,
  /服务.*不可用/,
];

export const resolveBookingUnavailable = (
  input: BookingUnavailableInput,
): BookingUnavailableResult => {
  const error = input.error || {};
  const statusCode = Number(error?.statusCode || error?.data?.statusCode || 0);
  const requestUrl = String(error?.url || error?.data?.url || error?.requestUrl || '');
  const errorCode = String(error?.error_code || error?.data?.error_code || '');
  const rawMessage = String(error?.message || error?.data?.message || '');
  const matchByCode = UNAVAILABLE_CODES.has(errorCode);
  const matchByMessage = UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(rawMessage));
  const matchByStatus = statusCode === 400;
  const matched = matchByCode || matchByMessage || matchByStatus;

  return {
    matched,
    statusCode,
    requestUrl,
    errorCode,
    rawMessage,
    userMessage: matched
      ? '该服务已下架或不可预约'
      : '',
  };
};
