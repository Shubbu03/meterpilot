import type { ServerConfig } from "@meterpilot/config/server";
import type { Logger } from "@meterpilot/observability";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];
export type ShutdownReason = ShutdownSignal | "requested";

type FetchHandler = (request: Request) => Response | Promise<Response>;

export type RuntimeListener = Readonly<{
  stop: (closeActiveConnections?: boolean) => Promise<void>;
}>;

export type ServerFactoryOptions = Readonly<{
  fetch: FetchHandler;
  hostname: string;
  port: number;
}>;

export type ServerFactory = (options: ServerFactoryOptions) => RuntimeListener;

export type ShutdownSignalSource = Readonly<{
  off: (signal: ShutdownSignal, listener: () => void) => void;
  once: (signal: ShutdownSignal, listener: () => void) => void;
}>;

export type ServerRuntime = Readonly<{
  stop: (reason?: ShutdownReason) => Promise<void>;
}>;

export type StartServerOptions = Readonly<{
  app: Readonly<{ fetch: FetchHandler }>;
  closeDatabase: () => Promise<void>;
  config: Pick<ServerConfig, "host" | "port">;
  logger: Logger;
  onShutdownFailure?: (error: unknown) => void;
  serve?: ServerFactory;
  signals?: ShutdownSignalSource;
}>;

const bunServerFactory: ServerFactory = (options) =>
  Bun.serve({
    fetch: options.fetch,
    hostname: options.hostname,
    port: options.port,
  });

const processSignals: ShutdownSignalSource = {
  off(signal, listener) {
    process.off(signal, listener);
  },
  once(signal, listener) {
    process.once(signal, listener);
  },
};

export function startServer(options: StartServerOptions): ServerRuntime {
  const serve = options.serve ?? bunServerFactory;
  const signals = options.signals ?? processSignals;
  const listener = serve({
    fetch: (request) => options.app.fetch(request),
    hostname: options.config.host,
    port: options.config.port,
  });
  const signalHandlers = new Map<ShutdownSignal, () => void>();
  let shutdown: Promise<void> | undefined;

  function detachSignalHandlers(): void {
    for (const [signal, handler] of signalHandlers) {
      signals.off(signal, handler);
    }
    signalHandlers.clear();
  }

  function stop(reason: ShutdownReason = "requested"): Promise<void> {
    if (shutdown) {
      return shutdown;
    }

    shutdown = (async () => {
      detachSignalHandlers();
      options.logger.info("server_shutdown_started", { reason });

      const errors: unknown[] = [];

      try {
        await listener.stop(false);
      } catch (error) {
        errors.push(error);
        options.logger.error("server_listener_stop_failed", { error });
      }

      try {
        await options.closeDatabase();
      } catch (error) {
        errors.push(error);
        options.logger.error("database_close_failed", { error });
      }

      if (errors.length > 0) {
        throw new AggregateError(errors, "Server shutdown failed.");
      }

      options.logger.info("server_shutdown_completed", { reason });
    })();

    return shutdown;
  }

  for (const signal of SHUTDOWN_SIGNALS) {
    const handler = () => {
      void stop(signal).catch((error: unknown) => {
        options.logger.error("server_shutdown_failed", { error, signal });
        if (options.onShutdownFailure) {
          options.onShutdownFailure(error);
        } else {
          process.exitCode = 1;
        }
      });
    };

    signalHandlers.set(signal, handler);
    signals.once(signal, handler);
  }

  options.logger.info("server_started", {
    host: options.config.host,
    port: options.config.port,
  });

  return Object.freeze({ stop });
}
