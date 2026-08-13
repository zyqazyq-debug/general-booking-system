export type AuthUserStatus = 'ACTIVE' | 'MERGED' | 'DISABLED';

export type AuthUserDto = {
  id: string;
  username: string;
  password: string | null;
  status: AuthUserStatus;
  merged_into_id: string | null;
  roles: string[];
  email: string | null;
  referral_code: string | null;
  phone: string | null;
  wechat_openid: string | null;
  qq_openid: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  wallet_balance: number;
  credit_balance: number;
  frozen_credit: number;
  is_verified: boolean;
  nickname: string | null;
  avatar: string | null;
};

export type AuthLoginUserDto = Omit<AuthUserDto, 'password'>;

export type CreateAuthUserByProviderDto = {
  username: string;
  nickname?: string;
  avatar?: string;
  wechat_openid?: string;
  qq_openid?: string;
  phone?: string;
  telegram_chat_id?: string;
  telegram_username?: string;
  is_verified?: boolean;
};

export type AuthRefreshTokenRecordDto = {
  user: AuthUserDto;
};
