console.error('[MIGRATE REVERT] FORBIDDEN: application rollback never invokes TypeORM migration:revert. Use a later, explicitly approved contract release instead.');
process.exitCode = 80;
