import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { UsersProfileService } from './services/users-profile.service';
import { UsersIdentityService } from './services/users-identity.service';
import { UsersReferralService } from './services/users-referral.service';
import { UserFinancialService } from './services/user-financial.service';
import { UserTokenService } from './services/user-token.service';

describe('UsersService', () => {
  let service: UsersService;

  const profileService = {
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    changePassword: jest.fn(),
  };

  const identityService = {
    findByPhone: jest.fn(),
    createWithProvider: jest.fn(),
    syncTelegramUser: jest.fn(),
  };

  const referralService = {
    findByReferralCode: jest.fn(),
  };

  const financialService = {
    freezeCredit: jest.fn(),
    createCreditPurchaseIntent: jest.fn(),
  };

  const tokenService = {
    validateRefreshToken: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersProfileService, useValue: profileService },
        { provide: UsersIdentityService, useValue: identityService },
        { provide: UsersReferralService, useValue: referralService },
        { provide: UserFinancialService, useValue: financialService },
        { provide: UserTokenService, useValue: tokenService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates profile mutations to UsersProfileService', async () => {
    const dto = { username: 'alice', password: 'secret' };
    profileService.create.mockResolvedValue({ id: 'user-1', ...dto });

    await expect(service.create(dto as never)).resolves.toMatchObject({
      id: 'user-1',
      username: 'alice',
    });
    expect(profileService.create).toHaveBeenCalledWith(dto);
  });

  it('delegates identity lookups to UsersIdentityService', async () => {
    identityService.findByPhone.mockResolvedValue({ id: 'user-2' });

    await expect(service.findByPhone('13800138000')).resolves.toEqual({
      id: 'user-2',
    });
    expect(identityService.findByPhone).toHaveBeenCalledWith('13800138000');
  });

  it('delegates referral lookup to UsersReferralService', async () => {
    referralService.findByReferralCode.mockResolvedValue({ id: 'user-3' });

    await expect(service.findByReferralCode('rabc123')).resolves.toEqual({
      id: 'user-3',
    });
    expect(referralService.findByReferralCode).toHaveBeenCalledWith('rabc123');
  });

  it('keeps financial and token proxy methods intact', async () => {
    financialService.freezeCredit.mockResolvedValue(undefined);
    financialService.createCreditPurchaseIntent.mockResolvedValue({
      payment_url: '/pay',
    });
    tokenService.validateRefreshToken.mockResolvedValue({
      user: { id: 'u-1' },
    });

    await expect(service.freezeCredit('u-1', 10)).resolves.toBeUndefined();
    await expect(
      service.createCreditPurchaseIntent('u-1', 20),
    ).resolves.toEqual({ payment_url: '/pay' });
    await expect(
      service.validateRefreshToken('refresh-token'),
    ).resolves.toEqual({ user: { id: 'u-1' } });

    expect(financialService.freezeCredit).toHaveBeenCalledWith(
      'u-1',
      10,
      undefined,
    );
    expect(financialService.createCreditPurchaseIntent).toHaveBeenCalledWith(
      'u-1',
      20,
    );
    expect(tokenService.validateRefreshToken).toHaveBeenCalledWith(
      'refresh-token',
    );
  });
});
