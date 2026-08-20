const SERVICE_NAME = "meterpilot-worker";

type WorkerLog = Readonly<{
  event: "worker_started" | "worker_stopped";
  level: "info";
  service: typeof SERVICE_NAME;
}>;

type WriteLog = (log: WorkerLog) => void;

function writeStructuredLog(log: WorkerLog): void {
  console.info(JSON.stringify(log));
}

export async function runWorker(
  signal: AbortSignal,
  writeLog: WriteLog = writeStructuredLog,
): Promise<void> {
  writeLog({
    event: "worker_started",
    level: "info",
    service: SERVICE_NAME,
  });

  if (!signal.aborted) {
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  writeLog({
    event: "worker_stopped",
    level: "info",
    service: SERVICE_NAME,
  });
}
