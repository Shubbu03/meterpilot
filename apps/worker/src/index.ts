import { bootstrapWorker } from "./runtime/bootstrap";

export { bootstrapWorker } from "./runtime/bootstrap";
export { runWorker } from "./runtime/worker";

function errorName(error: unknown): string {
  return error instanceof Error && error.name.trim().length > 0 ? error.name : "UnknownError";
}

async function main(): Promise<void> {
  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort();
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

  try {
    await bootstrapWorker(shutdown.signal);
  } catch (error) {
    console.error(
      JSON.stringify({
        errorName: errorName(error),
        event: "worker_startup_failed",
        level: "error",
        service: "meterpilot-worker",
        timestamp: new Date().toISOString(),
      }),
    );
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", requestShutdown);
    process.off("SIGTERM", requestShutdown);
  }
}

if (import.meta.main) {
  await main();
}
