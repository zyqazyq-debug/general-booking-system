import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { AgencyCollectionController } from './agency-collection.controller';

describe('AgencyCollectionController', () => {
  it('passes the authenticated actor into the owned node query', async () => {
    const agencyService = {
      findByIdForActor: jest.fn().mockResolvedValue({ id: 'node-1' }),
    };
    const controller = new AgencyCollectionController(agencyService as never);
    const request = {
      user: { id: 'actor-1', username: 'alice', roles: ['AGENT'] },
    } as AuthenticatedRequest;

    await expect(
      controller.getNodeById('node-1', request),
    ).resolves.toEqual({ id: 'node-1' });
    expect(agencyService.findByIdForActor).toHaveBeenCalledWith(
      'node-1',
      'actor-1',
    );
  });
});
