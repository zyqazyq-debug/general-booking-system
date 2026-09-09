import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { AuthSessionController } from './auth-session.controller';

describe('AuthSessionController logout ownership', () => {
  it('uses the authenticated actor rather than a body user id', async () => {
    const authService = {
      logout: jest.fn().mockResolvedValue({ success: true }),
    };
    const controller = new AuthSessionController(authService as never);
    const request = {
      user: { id: 'actor-1', username: 'alice', roles: ['CONSUMER'] },
    } as AuthenticatedRequest;

    await expect(
      controller.logout(request, { refresh_token: 'refresh-token' }),
    ).resolves.toEqual({ success: true });
    expect(authService.logout).toHaveBeenCalledWith('actor-1', 'refresh-token');
  });
});
