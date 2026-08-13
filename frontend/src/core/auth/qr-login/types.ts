export enum QrLoginStatus {
    INIT = 'INIT',
    SCANNED = 'SCANNED',
    CONFIRMED = 'CONFIRMED',
    CANCELLED = 'CANCELLED'
}

export type QrLoginProvider = 'wechat' | 'qq' | 'telegram';
