import { describe, expect, test } from "bun:test";
import { createObservability } from "@meterpilot/observability";

import type { AuthGateway } from "../src/features/identity/authentication";
import { createApp } from "../src/http/app";
import { documentedOperations, openApiDocument } from "../src/http/openapi";
import {
  createApiKeyServiceStub,
  createCatalogRepositoryStub,
  createCustomerRepositoryStub,
  createEntitlementRepositoryStub,
  createEventServiceStub,
  createJobOperationsRepositoryStub,
  createMeterRepositoryStub,
  createOperationsRepositoryStub,
  createOrganizationRepositoryStub,
  createPreviewRepositoryStub,
  createRetentionRepositoryStub,
  createSimulationRepositoryStub,
  createUsageRepositoryStub,
} from "./helpers";

function createFullyRegisteredApp() {
  const auth: AuthGateway = {
    getSession: () => Promise.resolve(null),
    handler: () => Promise.resolve(new Response("auth")),
  };
  return createApp({
    apiKeyService: createApiKeyServiceStub(),
    auth,
    catalogRepository: createCatalogRepositoryStub(),
    checkDatabaseHealth: () => Promise.resolve(),
    customerRepository: createCustomerRepositoryStub(),
    entitlementRepository: createEntitlementRepositoryStub(),
    eventService: createEventServiceStub(),
    jobOperationsRepository: createJobOperationsRepositoryStub(),
    meterRepository: createMeterRepositoryStub(),
    observability: createObservability({
      environment: "test",
      level: "error",
      service: "meterpilot-server",
      write: () => undefined,
    }),
    operationsRepository: createOperationsRepositoryStub(),
    organizationRepository: createOrganizationRepositoryStub(),
    previewRepository: createPreviewRepositoryStub(),
    retentionRepository: createRetentionRepositoryStub(),
    simulationRepository: createSimulationRepositoryStub(),
    usageRepository: createUsageRepositoryStub(),
  });
}

function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

describe("OpenAPI reference", () => {
  test("serves a cacheable OpenAPI 3.1 document", async () => {
    const response = await createFullyRegisteredApp().request("/openapi.json");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await response.json()).toEqual(openApiDocument);
  });

  test("documents every concrete HTTP route registered by the full server", () => {
    const app = createFullyRegisteredApp();
    const actual = new Set(
      app.routes
        .filter(
          (route) =>
            ["DELETE", "GET", "PATCH", "POST", "PUT"].includes(route.method) && route.path !== "*",
        )
        .map((route) => operationKey(route.method, route.path)),
    );
    const documented = new Set(
      documentedOperations.map((operation) => operationKey(operation.method, operation.path)),
    );

    expect([...actual].filter((operation) => !documented.has(operation))).toEqual([]);
    expect([...documented].filter((operation) => !actual.has(operation))).toEqual([]);
  });

  test("contains no dangling local component references", () => {
    const componentNames = new Set(Object.keys(openApiDocument.components.schemas));
    const references = JSON.stringify(openApiDocument).matchAll(
      /"\$ref":"#\/components\/schemas\/([^"]+)"/g,
    );
    const missing = [...references]
      .map((match) => match[1] ?? "")
      .filter((name) => !componentNames.has(name));

    expect(missing).toEqual([]);
  });
});
