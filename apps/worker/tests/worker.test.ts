import { describe, expect, test } from "bun:test";

import { runWorker } from "../src/runtime/worker";

describe("worker runtime", () => {
  test("waits for shutdown and records lifecycle events", async () => {
    const shutdown = new AbortController();
    const events: string[] = [];
    const running = runWorker(shutdown.signal, (log) => events.push(log.event));

    expect(events).toEqual(["worker_started"]);

    shutdown.abort();
    await running;

    expect(events).toEqual(["worker_started", "worker_stopped"]);
  });

  test("stops immediately when shutdown was already requested", async () => {
    const shutdown = new AbortController();
    const events: string[] = [];

    shutdown.abort();
    await runWorker(shutdown.signal, (log) => events.push(log.event));

    expect(events).toEqual(["worker_started", "worker_stopped"]);
  });
});
