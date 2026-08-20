import { describe, expect, test } from "bun:test";
import type { ServerConfig } from "@meterpilot/config/server";
import { createObservability, type Logger } from "@meterpilot/observability";

import type { AuthGateway } from "../src/features/identity/authentication";
import { type BootstrapDependencies, bootstrapServer } from "../src/runtime/bootstrap";
import {
  type ServerFactoryOptions,
  type ShutdownSignal,
  type ShutdownSignalSource,
  startServer,
} from "../src/runtime/server";
import { createApiKeyServiceStub, createOrganizationRepositoryStub } from "./helpers";

type LogEntry = Readonly<Record<string, unknown>>;

function createTestLogger(): Readonly<{ entries: LogEntry[]; logger: Logger }> {
  const entries: LogEntry[] = [];
  const logger = createObservability({
    environment: "test",
    level: "debug",
    service: "meterpilot-server",
    write(line) {
      entries.push(JSON.parse(line) as LogEntry);
    },
  }).logger;

  return { entries, logger };
}

function createSignalSource() {
  const handlers = new Map<ShutdownSignal, () => void>();
  const source: ShutdownSignalSource = {
    off(signal, listener) {
      if (handlers.get(signal) === listener) {
        handlers.delete(signal);
      }
    },
    once(signal, listener) {
      handlers.set(signal, listener);
    },
  };

  return {
    emit(signal: ShutdownSignal) {
      handlers.get(signal)?.();
    },
    handlers,
    source,
  };
}

const testConfig: ServerConfig = {
  authBaseUrl: "http://localhost:4321",
  authSecret: "test-secret-that-is-at-least-32-characters-long",
  databaseUrl: "postgresql://meterpilot:meterpilot_local@127.0.0.1:5432/meterpilot",
  host: "127.0.0.1",
  logLevel: "debug",
  nodeEnvironment: "test",
  port: 4321,
};

describe("server runtime", () => {
  test("binds configured host and port and shuts down gracefully once", async () => {
    const calls: string[] = [];
    const { entries, logger } = createTestLogger();
    const signalSource = createSignalSource();
    let serveOptions: ServerFactoryOptions | undefined;
    const runtime = startServer({
      app: { fetch: () => Promise.resolve(new Response("ok")) },
      closeDatabase: () => {
        calls.push("database_closed");
        return Promise.resolve();
      },
      config: testConfig,
      logger,
      serve(options) {
        serveOptions = options;
        return {
          stop(closeActiveConnections) {
            calls.push(`listener_stopped:${String(closeActiveConnections)}`);
            return Promise.resolve();
          },
        };
      },
      signals: signalSource.source,
    });

    expect(serveOptions?.hostname).toBe("127.0.0.1");
    expect(serveOptions?.port).toBe(4321);
    expect(signalSource.handlers.size).toBe(2);

    const firstStop = runtime.stop();
    const secondStop = runtime.stop();
    expect(secondStop).toBe(firstStop);
    await firstStop;

    expect(calls).toEqual(["listener_stopped:false", "database_closed"]);
    expect(signalSource.handlers.size).toBe(0);
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "server_started", host: "127.0.0.1", port: 4321 }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "server_shutdown_completed", reason: "requested" }),
    );
  });

  test("handles termination signals through the same shutdown path", async () => {
    const { entries, logger } = createTestLogger();
    const signalSource = createSignalSource();
    let stopped = false;
    let databaseClosed = false;
    const runtime = startServer({
      app: { fetch: () => new Response("ok") },
      closeDatabase: () => {
        databaseClosed = true;
        return Promise.resolve();
      },
      config: testConfig,
      logger,
      serve: () => ({
        stop() {
          stopped = true;
          return Promise.resolve();
        },
      }),
      signals: signalSource.source,
    });

    signalSource.emit("SIGTERM");
    await runtime.stop();

    expect(stopped).toBe(true);
    expect(databaseClosed).toBe(true);
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "server_shutdown_completed", reason: "SIGTERM" }),
    );
  });

  test("attempts both listener and database cleanup when shutdown fails", async () => {
    const { entries, logger } = createTestLogger();
    const signalSource = createSignalSource();
    let databaseCloseAttempted = false;
    const runtime = startServer({
      app: { fetch: () => new Response("ok") },
      closeDatabase: () => {
        databaseCloseAttempted = true;
        return Promise.reject(new Error("database close failed"));
      },
      config: testConfig,
      logger,
      serve: () => ({
        stop: () => Promise.reject(new Error("listener stop failed")),
      }),
      signals: signalSource.source,
    });

    await expect(runtime.stop()).rejects.toBeInstanceOf(AggregateError);

    expect(databaseCloseAttempted).toBe(true);
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "server_listener_stop_failed" }),
    );
    expect(entries).toContainEqual(expect.objectContaining({ event: "database_close_failed" }));
  });
});

describe("server bootstrap", () => {
  test("composes config, observability, database health, and runtime dependencies", async () => {
    const databaseClient = {} as never;
    let checkedClient: unknown;
    let receivedRuntimeOptions: Parameters<BootstrapDependencies["startServer"]>[0] | undefined;
    const runtime = Object.freeze({ stop: () => Promise.resolve() });
    const observability = createObservability({
      environment: "test",
      level: "debug",
      service: "meterpilot-server",
      write: () => undefined,
    });
    const auth: AuthGateway = {
      getSession: () => Promise.resolve(null),
      handler: () => Promise.resolve(new Response("auth response")),
    };
    const dependencies: BootstrapDependencies = {
      checkDatabaseHealth(client) {
        checkedClient = client;
        return Promise.resolve();
      },
      createApiKeyService: () => createApiKeyServiceStub(),
      createAuthGateway: () => auth,
      createDatabase: () => ({
        client: databaseClient,
        close: () => Promise.resolve(),
        db: {} as never,
      }),
      createObservability: () => observability,
      createOrganizationRepository: () => createOrganizationRepositoryStub(),
      parseServerConfig: () => testConfig,
      startServer(options) {
        receivedRuntimeOptions = options;
        return runtime;
      },
    };

    const result = await bootstrapServer(dependencies);
    const healthResponse = await receivedRuntimeOptions?.app.fetch(
      new Request("http://localhost/health"),
    );

    expect(result).toBe(runtime);
    expect(receivedRuntimeOptions?.config).toBe(testConfig);
    expect(receivedRuntimeOptions?.logger).toBe(observability.logger);
    expect(healthResponse?.status).toBe(200);
    expect(checkedClient).toBe(databaseClient);
  });

  test("closes the database when listener startup fails", async () => {
    const { entries, logger } = createTestLogger();
    let databaseClosed = false;
    const startupError = new Error("address in use");
    const observability = {
      ...createObservability({
        environment: "test",
        level: "debug",
        service: "meterpilot-server",
      }),
      logger,
    };
    const dependencies: BootstrapDependencies = {
      checkDatabaseHealth: () => Promise.resolve(),
      createApiKeyService: () => createApiKeyServiceStub(),
      createAuthGateway: () => ({
        getSession: () => Promise.resolve(null),
        handler: () => Promise.resolve(new Response("auth response")),
      }),
      createDatabase: () => ({
        client: {} as never,
        close: () => {
          databaseClosed = true;
          return Promise.resolve();
        },
        db: {} as never,
      }),
      createObservability: () => observability,
      createOrganizationRepository: () => createOrganizationRepositoryStub(),
      parseServerConfig: () => testConfig,
      startServer: () => {
        throw startupError;
      },
    };

    await expect(bootstrapServer(dependencies)).rejects.toBe(startupError);

    expect(databaseClosed).toBe(true);
    expect(entries).toContainEqual(expect.objectContaining({ event: "server_startup_failed" }));
  });
});
