export * from './auth.module';
export * from './adapters/agency-auth.adapter';
export * from './adapters/platform-auth.adapter';
// 非组合根请优先从 ./index 导入 guards / decorators。
// 这里保留重导出仅用于兼容遗留调用方，避免本轮调整期间破坏功能。
export {
  Roles,
  ROLES_KEY,
  JwtAuthGuard,
  OptionalJwtAuthGuard,
  RolesGuard,
} from './index';
