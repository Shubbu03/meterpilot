import {
  eventIngestionResponseSchema,
  MAX_EVENT_BATCH_SIZE,
  type EventIngestionResponse,
  type UsageEvent,
  usageEventSchema,
} from "@meterpilot/contracts/events";
import {
  publicErrorResponseSchema,
  type PublicValidationIssue,
  requestIdSchema,
} from "@meterpilot/contracts/common";

import {
  MeterPilotConfigurationError,
  MeterPilotHttpError,
  MeterPilotResponseError,
  MeterPilotTimeoutError,
  MeterPilotValidationError,
} from "./errors";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_SIZE_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type MeterPilotClientOptions = Readonly<{
  apiKey: string | undefined;
  baseUrl: string;
  fetch?: Fetch;
  requestIdFactory?: () => string;
  timeoutMs?: number;
}>;

export type MeterPilotRequestOptions = Readonly<{
  requestId?: string;
  signal?: AbortSignal;
}>;

export type EventsClient = Readonly<{
  send: (event: UsageEvent, options?: MeterPilotRequestOptions) => Promise<EventIngestionResponse>;
  sendBatch: (
    events: readonly UsageEvent[],
    options?: MeterPilotRequestOptions,
  ) => Promise<EventIngestionResponse>;
}>;

export type MeterPilotClient = Readonly<{
  events: EventsClient;
}>;

function parseBaseUrl(value: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new MeterPilotConfigurationError("MeterPilot baseUrl must be a valid URL.");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new MeterPilotConfigurationError(
      "MeterPilot baseUrl must not include credentials, a query, or a fragment.",
    );
  }

  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  ) {
    throw new MeterPilotConfigurationError(
      "MeterPilot baseUrl must use HTTPS, except for loopback development URLs.",
    );
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }

  return url;
}

function parseOptions(options: MeterPilotClientOptions) {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new MeterPilotConfigurationError("MeterPilot apiKey is required.");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new MeterPilotConfigurationError(
      `MeterPilot timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}.`,
    );
  }

  return {
    apiKey,
    baseUrl: parseBaseUrl(options.baseUrl),
    fetch: options.fetch ?? globalThis.fetch,
    requestIdFactory: options.requestIdFactory ?? (() => crypto.randomUUID()),
    timeoutMs,
  };
}

function validationIssues(error: {
  issues: readonly { message: string; path: readonly PropertyKey[] }[];
}) {
  return error.issues.map<PublicValidationIssue>((issue) => ({
    field: issue.path.map(String).join(".") || "value",
    message: issue.message,
  }));
}

function assertEvents(events: readonly UsageEvent[]): void {
  if (events.length < 1 || events.length > MAX_EVENT_BATCH_SIZE) {
    throw new MeterPilotValidationError([
      {
        field: "events",
        message: `Must contain between 1 and ${MAX_EVENT_BATCH_SIZE} events.`,
      },
    ]);
  }

  const issues: PublicValidationIssue[] = [];
  events.forEach((event, index) => {
    const result = usageEventSchema.safeParse(event);
    if (!result.success) {
      issues.push(
        ...validationIssues(result.error).map((issue) => ({
          field: `events.${index}.${issue.field}`,
          message: issue.message,
        })),
      );
    }
  });

  if (issues.length > 0) {
    throw new MeterPilotValidationError(issues);
  }
}

function requestId(options: MeterPilotRequestOptions, factory: () => string): string {
  const result = requestIdSchema.safeParse(options.requestId ?? factory());
  if (!result.success) {
    throw new MeterPilotValidationError(validationIssues(result.error));
  }
  return result.data;
}

async function readJsonResponse(response: Response, requestId: string): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_SIZE_BYTES) {
    throw new MeterPilotResponseError(requestId);
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_SIZE_BYTES) {
    throw new MeterPilotResponseError(requestId);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MeterPilotResponseError(requestId);
  }
}

function createAbortSignal(callerSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  return {
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
    signal: controller.signal,
    timedOut: () => timedOut,
  };
}

export function createMeterPilotClient(options: MeterPilotClientOptions): MeterPilotClient {
  const configuration = parseOptions(options);

  async function ingest(
    endpoint: string,
    body: unknown,
    requestOptions: MeterPilotRequestOptions = {},
  ): Promise<EventIngestionResponse> {
    const currentRequestId = requestId(requestOptions, configuration.requestIdFactory);
    const abort = createAbortSignal(requestOptions.signal, configuration.timeoutMs);

    try {
      let response: Response;
      try {
        response = await configuration.fetch(new URL(endpoint, configuration.baseUrl), {
          body: JSON.stringify(body),
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${configuration.apiKey}`,
            "Content-Type": "application/json",
            "X-Request-Id": currentRequestId,
          },
          method: "POST",
          redirect: "error",
          signal: abort.signal,
        });
      } catch (error) {
        if (abort.timedOut()) {
          throw new MeterPilotTimeoutError(configuration.timeoutMs);
        }
        throw error;
      }

      const payload = await readJsonResponse(response, currentRequestId);

      if (response.status !== 202) {
        const parsedError = publicErrorResponseSchema.safeParse(payload);
        if (parsedError.success) {
          throw new MeterPilotHttpError(
            response.status,
            parsedError.data.error.code,
            parsedError.data.error.message,
            parsedError.data.error.requestId,
            parsedError.data.error.details,
          );
        }

        throw new MeterPilotHttpError(
          response.status,
          "unexpected_http_status",
          "MeterPilot rejected the request.",
          currentRequestId,
        );
      }

      const parsedResponse = eventIngestionResponseSchema.safeParse(payload);
      if (!parsedResponse.success) {
        throw new MeterPilotResponseError(currentRequestId);
      }

      return parsedResponse.data;
    } finally {
      abort.cleanup();
    }
  }

  const events: EventsClient = Object.freeze({
    async send(event, requestOptions) {
      assertEvents([event]);
      return ingest("v1/events", event, requestOptions);
    },
    async sendBatch(eventsToSend, requestOptions) {
      assertEvents(eventsToSend);
      return ingest("v1/events/batch", { events: eventsToSend }, requestOptions);
    },
  });

  return Object.freeze({ events });
}
