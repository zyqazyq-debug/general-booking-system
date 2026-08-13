export interface CleanupTasksUsersPort {
  cleanupAllExpiredTokens(): Promise<number>;
}
