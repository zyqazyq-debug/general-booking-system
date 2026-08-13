export interface CleanupTasksServicesPort {
  cleanupExpiredBlocks(): Promise<number>;
}
