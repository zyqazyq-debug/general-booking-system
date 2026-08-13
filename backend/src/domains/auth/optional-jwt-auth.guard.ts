import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { AuthenticatedUser } from '../../shared/common/types/auth-request.type';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser | false,
    info: { message?: string } | undefined,
    context: ExecutionContext,
  ): TUser | null {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request?.headers?.authorization;
    const hasAuthorization =
      typeof authHeader === 'string' && authHeader.trim().length > 0;

    if (user) {
      return user as TUser;
    }

    if (hasAuthorization) {
      throw (
        (err as Error) ||
        new UnauthorizedException(info?.message || 'Invalid token')
      );
    }

    return null;
  }
}
