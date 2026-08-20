import { runWorker } from "./runtime/worker";

const shutdown = new AbortController();
const requestShutdown = () => shutdown.abort();

process.once("SIGINT", requestShutdown);
process.once("SIGTERM", requestShutdown);

try {
  await runWorker(shutdown.signal);
} finally {
  process.off("SIGINT", requestShutdown);
  process.off("SIGTERM", requestShutdown);
}
