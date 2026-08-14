import { SQL } from "bun";
import { readDatabaseUrl } from "@meterpilot/config/database";
import { drizzle } from "drizzle-orm/bun-sql";

const DEFAULT_MAX_CONNECTIONS = 10;

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(
  databaseUrl = readDatabaseUrl(),
  maxConnections = DEFAULT_MAX_CONNECTIONS,
) {
  const client = new SQL({
    connectionTimeout: 10,
    idleTimeout: 30,
    max: maxConnections,
    url: databaseUrl,
  });
  const db = drizzle({ client });

  return {
    client,
    close: () => client.close({ timeout: 5 }),
    db,
  };
}
