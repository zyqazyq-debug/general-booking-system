import { ValidationPipe } from '@nestjs/common';
import { CreateAuthUserDto } from '../dto/create-auth-user.dto';
import { ZRegisterSchema } from '../dto/register.schema';
import { RegistrationService } from './registration.service';

describe('public registration security', () => {
  const usersPort = {
    findByUsername: jest.fn(),
    findByReferralCode: jest.fn(),
    create: jest.fn(),
  };
  const authTokenService = { login: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    usersPort.findByUsername.mockResolvedValue(null);
    usersPort.findByReferralCode.mockResolvedValue({ id: 'referrer-1' });
    usersPort.create.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      roles: ['CONSUMER'],
    });
    authTokenService.login.mockResolvedValue({ access_token: 'access' });
  });

  it.each(['roles', 'referrer_id'])(
    'rejects forbidden public field %s at the transport boundary',
    async (field) => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });
      const payload: Record<string, unknown> = {
        username: 'alice',
        password: 'correct horse battery staple',
        [field]: field === 'roles' ? ['ADMIN'] : 'attacker-chosen-user',
      };

      await expect(
        pipe.transform(payload, {
          type: 'body',
          metatype: CreateAuthUserDto,
        }),
      ).rejects.toThrow();
    },
  );

  it.each(['roles', 'referrer_id'])(
    'rejects forbidden public field %s in the shared Zod contract',
    (field) => {
      expect(() =>
        ZRegisterSchema.parse({
          username: 'alice',
          password: 'correct horse battery staple',
          [field]: field === 'roles' ? ['ADMIN'] : 'attacker-chosen-user',
        }),
      ).toThrow();
    },
  );

  it('forces CONSUMER and resolves attribution only from referral_code', async () => {
    const service = new RegistrationService(
      usersPort as never,
      authTokenService as never,
    );

    await service.register({
      username: 'alice',
      password: 'correct horse battery staple',
      referral_code: 'rABC123',
    });

    expect(usersPort.findByReferralCode).toHaveBeenCalledWith('rABC123');
    expect(usersPort.create).toHaveBeenCalledWith({
      username: 'alice',
      password: 'correct horse battery staple',
      referral_code: 'rABC123',
      referrer_id: 'referrer-1',
      roles: ['CONSUMER'],
    });
  });
});
