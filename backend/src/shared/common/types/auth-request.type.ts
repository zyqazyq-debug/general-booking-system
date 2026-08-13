import { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  username: string;
  roles: string[];
}

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

export type OptionalAuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};
