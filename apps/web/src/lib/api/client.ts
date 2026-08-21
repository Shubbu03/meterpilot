import {
  type PublicErrorCode,
  type PublicValidationIssue,
  publicErrorResponseSchema,
  requestIdSchema,
} from "@meterpilot/contracts/common";
import type { z } from "zod";
import { notifySessionExpired } from "../auth/session-events";
import { webConfig } from "../config";

export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type UnauthorizedHandler = () => void;

export interface ApiRequestOptions extends Omit<RequestInit, "body" | "headers"> {
  headers?: HeadersInit;
  json?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  readonly code: PublicErrorCode;
  readonly details: readonly PublicValidationIssue[];
  readonly requestId: string;
  readonly status: number;

  constructor(options: {
    code: PublicErrorCode;
    details?: readonly PublicValidationIssue[];
    message: string;
    requestId: string;
    status: number;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.code = options.code;
    this.details = options.details ?? [];
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

export class ApiContractError extends Error {
  readonly requestId: string;
  readonly status: number;

  constructor(status: number, requestId: string) {
    super("The server returned an unexpected response.");
    this.name = "ApiContractError";
    this.requestId = requestId;
    this.status = status;
  }
}

function createRequestId() {
  return crypto.randomUUID();
}

function getResponseRequestId(response: Response, fallback: string) {
  const parsedRequestId = requestIdSchema.safeParse(response.headers.get("x-request-id"));
  return parsedRequestId.success ? parsedRequestId.data : fallback;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export class ApiClient {
  readonly baseUrl: URL;
  readonly fetcher: ApiFetch;
  readonly onUnauthorized: UnauthorizedHandler;

  constructor(
    baseUrl: string,
    fetcher: ApiFetch = fetch,
    onUnauthorized: UnauthorizedHandler = () => undefined,
  ) {
    this.baseUrl = new URL(baseUrl);
    this.fetcher = fetcher;
    this.onUnauthorized = onUnauthorized;
  }

  async request<TOutput>(
    path: string,
    schema: z.ZodType<TOutput>,
    options: ApiRequestOptions = {},
  ): Promise<TOutput> {
    const requestUrl = new URL(path, this.baseUrl);

    if (requestUrl.origin !== this.baseUrl.origin) {
      throw new TypeError("API requests must target the configured server origin.");
    }

    const requestId = requestIdSchema.parse(options.requestId ?? createRequestId());
    const headers = new Headers(options.headers);
    headers.set("accept", "application/json");
    headers.set("x-request-id", requestId);

    if (options.json !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const { headers: _headers, json, requestId: _requestId, ...requestInit } = options;
    const requestBody = json === undefined ? {} : { body: JSON.stringify(json) };

    const response = await this.fetcher(requestUrl, {
      ...requestInit,
      ...requestBody,
      credentials: "include",
      headers,
    });
    const responseBody = await readJson(response);
    const responseRequestId = getResponseRequestId(response, requestId);

    if (!response.ok) {
      if (response.status === 401) {
        this.onUnauthorized();
      }

      const parsedError = publicErrorResponseSchema.safeParse(responseBody);

      if (!parsedError.success) {
        throw new ApiContractError(response.status, responseRequestId);
      }

      const errorOptions = {
        code: parsedError.data.error.code,
        message: parsedError.data.error.message,
        requestId: parsedError.data.error.requestId,
        status: response.status,
        ...(parsedError.data.error.details === undefined
          ? {}
          : { details: parsedError.data.error.details }),
      };

      throw new ApiError(errorOptions);
    }

    const parsedResponse = schema.safeParse(responseBody);

    if (!parsedResponse.success) {
      throw new ApiContractError(response.status, responseRequestId);
    }

    return parsedResponse.data;
  }
}

export const apiClient = new ApiClient(webConfig.apiBaseUrl, fetch, notifySessionExpired);
