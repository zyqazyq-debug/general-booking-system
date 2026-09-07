import { AuthPublicController } from './auth-public.controller';

describe('AuthPublicController social proof transport', () => {
  it.each(['wechat', 'qq'] as const)(
    'passes only a verified-proof envelope for %s login',
    async (provider) => {
      const authService = {
        loginWithSocialProof: jest.fn().mockResolvedValue({
          access_token: 'access',
        }),
      };
      const controller = new AuthPublicController(authService as never);
      const body = { proof: 'signed-proof', deviceInfo: { device: 'web' } };

      const result =
        provider === 'wechat'
          ? await controller.wechatLogin(body)
          : await controller.qqLogin(body);

      expect(result).toEqual({ access_token: 'access' });
      expect(authService.loginWithSocialProof).toHaveBeenCalledWith(
        provider,
        'signed-proof',
        { device: 'web' },
      );
    },
  );
});
