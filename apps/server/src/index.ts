import { bootstrapServer } from "./runtime/bootstrap";

export { bootstrapServer } from "./runtime/bootstrap";
export { type ServerRuntime, startServer } from "./runtime/server";

function errorName(error: unknown): string {
  return error instanceof Error && error.name.trim().length > 0 ? error.name : "UnknownError";
}

async function main(): Promise<void> {
  try {
    await bootstrapServer();
  } catch (error) {
    console.error(
      JSON.stringify({
        errorName: errorName(error),
        event: "server_startup_failed",
        level: "error",
        service: "meterpilot-server",
        timestamp: new Date().toISOString(),
      }),
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
