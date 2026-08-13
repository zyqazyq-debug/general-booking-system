export type InitUserForAuthDto = {
  id: string;
  roles: string[];
};

export interface InitUsersPort {
  findForAuth(usernameOrPhone: string): Promise<InitUserForAuthDto | null>;
  createAdminUser(username: string, password: string): Promise<void>;
  addRole(userId: string, role: string): Promise<void>;
}
