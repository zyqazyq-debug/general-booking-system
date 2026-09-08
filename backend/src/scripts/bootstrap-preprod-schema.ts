import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';

const REQUIRED_ENVIRONMENT = 'preproduction';
const REQUIRED_DATABASE = 'booking_preprod';
const REQUIRED_HOST = 'postgres';

export type PreprodBootstrapTarget = {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
};

export function readPreprodBootstrapTarget(
  env: NodeJS.ProcessEnv,
): PreprodBootstrapTarget {
  if (env.BOOKING_SCHEMA_BOOTSTRAP !== 'true') {
    throw new Error('BOOKING_SCHEMA_BOOTSTRAP=true is required');
  }
  if (env.NODE_ENV !== REQUIRED_ENVIRONMENT) {
    throw new Error(
      `schema bootstrap is restricted to NODE_ENV=${REQUIRED_ENVIRONMENT}`,
    );
  }
  if (env.POSTGRES_HOST !== REQUIRED_HOST) {
    throw new Error(`schema bootstrap is restricted to ${REQUIRED_HOST}`);
  }
  if (env.POSTGRES_DB !== REQUIRED_DATABASE) {
    throw new Error(`schema bootstrap is restricted to ${REQUIRED_DATABASE}`);
  }

  const username = env.POSTGRES_USER;
  const password = env.POSTGRES_PASSWORD;
  if (!username || !password) {
    throw new Error('isolated PostgreSQL credentials are required');
  }

  const port = Number(env.POSTGRES_PORT || '5432');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('POSTGRES_PORT must be a valid TCP port');
  }

  return {
    host: REQUIRED_HOST,
    port,
    username,
    password,
    database: REQUIRED_DATABASE,
  };
}

function buildOptions(target: PreprodBootstrapTarget): DataSourceOptions {
  return {
    type: 'postgres',
    ...target,
    // This command is intentionally the only allowed empty-database baseline.
    // Evolution afterwards must use the reviewed migration workflow.
    entities: [join(__dirname, '../**/*.entity.js')],
    synchronize: false,
    logging: ['error'],
  };
}

async function main() {
  const target = readPreprodBootstrapTarget(process.env);
  const dataSource = new DataSource(buildOptions(target));

  try {
    await dataSource.initialize();
    const [{ table_count: tableCount }] = await dataSource.query<
      Array<{ table_count: string }>
    >(
      "SELECT COUNT(*)::text AS table_count FROM pg_tables WHERE schemaname = 'public'",
    );

    if (tableCount !== '0') {
      throw new Error(
        `schema bootstrap requires an empty public schema; found ${tableCount} tables`,
      );
    }

    await dataSource.synchronize();
    const [{ table_count: createdTableCount }] = await dataSource.query<
      Array<{ table_count: string }>
    >(
      "SELECT COUNT(*)::text AS table_count FROM pg_tables WHERE schemaname = 'public'",
    );
    console.log(
      JSON.stringify({
        status: 'pass',
        target: REQUIRED_DATABASE,
        createdTableCount: Number(createdTableCount),
      }),
    );
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`schema bootstrap failed: ${message}`);
    process.exitCode = 1;
  });
}
