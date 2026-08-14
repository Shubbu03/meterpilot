import { parseDatabaseUrl } from "@meterpilot/config/database";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  breakpoints: true,
  dialect: "postgresql",
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
  out: "./migrations",
  schema: "./src/schema/index.ts",
  strict: true,
  ...(databaseUrl
    ? {
        dbCredentials: {
          url: parseDatabaseUrl(databaseUrl),
        },
      }
    : {}),
});
