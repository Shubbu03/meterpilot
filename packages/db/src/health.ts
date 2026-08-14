import type { SQL } from "bun";

export async function checkDatabaseHealth(client: SQL): Promise<void> {
  await client`select 1 as ok`;
}
