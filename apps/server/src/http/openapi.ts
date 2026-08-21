import type { ApiKeyScope } from "@meterpilot/contracts";
import * as contracts from "@meterpilot/contracts";
import { z } from "zod";

type HttpMethod = "delete" | "get" | "patch" | "post" | "put";
type SecurityKind = "apiKey" | "public" | "session";
type SchemaMode = "input" | "output";

type ComponentDefinition = Readonly<{
  mode: SchemaMode;
  schema: z.ZodType;
}>;

type OperationDefinition = Readonly<{
  body?: keyof typeof componentDefinitions;
  description?: string;
  method: HttpMethod;
  path: string;
  query?: z.ZodType;
  response?: keyof typeof componentDefinitions;
  responseContentType?: "application/json" | "text/csv" | "text/plain";
  responseDescription?: string;
  scopes?: readonly ApiKeyScope[];
  security: SecurityKind;
  status?: number;
  summary: string;
  tag: string;
}>;

const planDetailResponseSchema = z.strictObject({ plan: contracts.planSchema });
const simulationReportResponseSchema = z.strictObject({
  results: z.array(contracts.simulationResultSchema),
  simulation: contracts.simulationSchema,
});
const eventBatchRequestSchema = z.strictObject({
  events: z.array(contracts.usageEventSchema).min(1).max(100),
});

const componentDefinitions = {
  AddOrganizationMemberRequest: {
    mode: "input",
    schema: contracts.addOrganizationMemberRequestSchema,
  },
  AttachCustomerSubjectRequest: {
    mode: "input",
    schema: contracts.attachCustomerSubjectRequestSchema,
  },
  ApiKeyListResponse: { mode: "output", schema: contracts.apiKeyListResponseSchema },
  AuditLogListResponse: { mode: "output", schema: contracts.auditLogListResponseSchema },
  BillingExportListResponse: { mode: "output", schema: contracts.billingExportListResponseSchema },
  BillingExportMutationResponse: {
    mode: "output",
    schema: contracts.billingExportMutationResponseSchema,
  },
  BillingExportResponse: { mode: "output", schema: contracts.billingExportResponseSchema },
  CancelSubscriptionRequest: { mode: "input", schema: contracts.cancelSubscriptionRequestSchema },
  CommitQuotaReservationRequest: {
    mode: "input",
    schema: contracts.commitQuotaReservationRequestSchema,
  },
  ConfigureEntitlementRequest: {
    mode: "input",
    schema: contracts.configureEntitlementRequestSchema,
  },
  CreateApiKeyRequest: { mode: "input", schema: contracts.createApiKeyRequestSchema },
  CreateCustomerRequest: { mode: "input", schema: contracts.createCustomerRequestSchema },
  CreateFeatureRequest: { mode: "input", schema: contracts.createFeatureRequestSchema },
  CreateInvoicePreviewRequest: {
    mode: "input",
    schema: contracts.createInvoicePreviewRequestSchema,
  },
  CreateMeterRequest: { mode: "input", schema: contracts.createMeterRequestSchema },
  CreateMeterVersionRequest: { mode: "input", schema: contracts.createMeterVersionRequestSchema },
  CreateOrganizationRequest: {
    mode: "input",
    schema: contracts.createOrganizationRequestSchema,
  },
  CreateOrganizationResponse: {
    mode: "output",
    schema: contracts.createOrganizationResponseSchema,
  },
  CreatePlanRequest: { mode: "input", schema: contracts.createPlanRequestSchema },
  CreatePlanVersionRequest: {
    mode: "input",
    schema: contracts.createPlanVersionRequestSchema,
  },
  CreateQuotaGrantRequest: { mode: "input", schema: contracts.createQuotaGrantRequestSchema },
  CreateQuotaReservationRequest: {
    mode: "input",
    schema: contracts.createQuotaReservationRequestSchema,
  },
  CreateReconciliationRunRequest: {
    mode: "input",
    schema: contracts.createReconciliationRunRequestSchema,
  },
  CreateReplayRequest: { mode: "input", schema: contracts.createReplayRequestSchema },
  CreateSimulationRequest: { mode: "input", schema: contracts.createSimulationRequestSchema },
  CreateStripeInvoiceLineExportRequest: {
    mode: "input",
    schema: contracts.createStripeInvoiceLineExportRequestSchema,
  },
  CreateSubscriptionRequest: {
    mode: "input",
    schema: contracts.createSubscriptionRequestSchema,
  },
  CustomerDetailResponse: { mode: "output", schema: contracts.customerDetailResponseSchema },
  CustomerListResponse: { mode: "output", schema: contracts.customerListResponseSchema },
  CustomerMutationResponse: { mode: "output", schema: contracts.customerMutationResponseSchema },
  CustomerSubjectMutationResponse: {
    mode: "output",
    schema: contracts.customerSubjectMutationResponseSchema,
  },
  DuplicatePlanVersionRequest: {
    mode: "input",
    schema: contracts.duplicatePlanVersionRequestSchema,
  },
  EntitlementResponse: { mode: "output", schema: contracts.entitlementResponseSchema },
  EventBatchRequest: { mode: "input", schema: eventBatchRequestSchema },
  EventIngestionResponse: { mode: "output", schema: contracts.eventIngestionResponseSchema },
  FailedJobListResponse: { mode: "output", schema: contracts.failedJobListResponseSchema },
  FailedJobResponse: { mode: "output", schema: contracts.failedJobResponseSchema },
  FeatureListResponse: { mode: "output", schema: contracts.featureListResponseSchema },
  FeatureMutationResponse: { mode: "output", schema: contracts.featureMutationResponseSchema },
  HealthResponse: { mode: "output", schema: contracts.healthResponseSchema },
  InvoicePreviewListResponse: {
    mode: "output",
    schema: contracts.invoicePreviewListResponseSchema,
  },
  InvoicePreviewMutationResponse: {
    mode: "output",
    schema: contracts.invoicePreviewMutationResponseSchema,
  },
  InvoicePreviewResponse: { mode: "output", schema: contracts.invoicePreviewResponseSchema },
  InvoicePreviewRevisionListResponse: {
    mode: "output",
    schema: contracts.invoicePreviewRevisionListResponseSchema,
  },
  MeterListResponse: { mode: "output", schema: contracts.meterListResponseSchema },
  MeterMutationResponse: { mode: "output", schema: contracts.meterMutationResponseSchema },
  MeterPublishResponse: { mode: "output", schema: contracts.meterPublishResponseSchema },
  MeterVersionMutationResponse: {
    mode: "output",
    schema: contracts.meterVersionMutationResponseSchema,
  },
  OrganizationDetailResponse: {
    mode: "output",
    schema: contracts.organizationDetailResponseSchema,
  },
  OrganizationListResponse: { mode: "output", schema: contracts.organizationListResponseSchema },
  OrganizationMembershipListResponse: {
    mode: "output",
    schema: contracts.organizationMembershipListResponseSchema,
  },
  OrganizationMembershipMutationResponse: {
    mode: "output",
    schema: contracts.organizationMembershipMutationResponseSchema,
  },
  OrganizationMembershipRemovalResponse: {
    mode: "output",
    schema: contracts.organizationMembershipRemovalResponseSchema,
  },
  PlanDetailResponse: { mode: "output", schema: planDetailResponseSchema },
  PlanListResponse: { mode: "output", schema: contracts.planListResponseSchema },
  PlanMutationResponse: { mode: "output", schema: contracts.planMutationResponseSchema },
  PlanVersionMutationResponse: {
    mode: "output",
    schema: contracts.planVersionMutationResponseSchema,
  },
  PublicError: { mode: "output", schema: contracts.publicErrorResponseSchema },
  QuotaGrantMutationResponse: {
    mode: "output",
    schema: contracts.quotaGrantMutationResponseSchema,
  },
  QuotaReservationMutationResponse: {
    mode: "output",
    schema: contracts.quotaReservationMutationResponseSchema,
  },
  ReconciliationFindingListResponse: {
    mode: "output",
    schema: contracts.reconciliationFindingListResponseSchema,
  },
  ReconciliationRunListResponse: {
    mode: "output",
    schema: contracts.reconciliationRunListResponseSchema,
  },
  ReconciliationRunMutationResponse: {
    mode: "output",
    schema: contracts.reconciliationRunMutationResponseSchema,
  },
  ReconciliationRunResponse: {
    mode: "output",
    schema: contracts.reconciliationRunResponseSchema,
  },
  RetentionPolicyMutationResponse: {
    mode: "output",
    schema: contracts.retentionPolicyMutationResponseSchema,
  },
  RetentionPolicyResponse: { mode: "output", schema: contracts.retentionPolicyResponseSchema },
  RevealedApiKeyResponse: { mode: "output", schema: contracts.revealedApiKeyResponseSchema },
  RetryFailedJobRequest: { mode: "input", schema: contracts.retryFailedJobRequestSchema },
  RetryFailedJobResponse: { mode: "output", schema: contracts.retryFailedJobResponseSchema },
  RevokedApiKeyResponse: { mode: "output", schema: contracts.revokedApiKeyResponseSchema },
  SimulationListResponse: { mode: "output", schema: contracts.simulationListResponseSchema },
  SimulationMutationResponse: {
    mode: "output",
    schema: contracts.simulationMutationResponseSchema,
  },
  SimulationReportResponse: { mode: "output", schema: simulationReportResponseSchema },
  SimulationResponse: { mode: "output", schema: contracts.simulationResponseSchema },
  SimulationResultListResponse: {
    mode: "output",
    schema: contracts.simulationResultListResponseSchema,
  },
  StripeInvoiceLineExportFile: {
    mode: "output",
    schema: contracts.stripeInvoiceLineExportFileSchema,
  },
  SubscriptionListResponse: { mode: "output", schema: contracts.subscriptionListResponseSchema },
  SubscriptionMutationResponse: {
    mode: "output",
    schema: contracts.subscriptionMutationResponseSchema,
  },
  UpdateOrganizationMemberRequest: {
    mode: "input",
    schema: contracts.updateOrganizationMemberRequestSchema,
  },
  UpdateRetentionPolicyRequest: {
    mode: "input",
    schema: contracts.updateRetentionPolicyRequestSchema,
  },
  UsageEventCorrectionRequest: {
    mode: "input",
    schema: contracts.usageEventCorrectionRequestSchema,
  },
  UsageEventCorrectionResponse: {
    mode: "output",
    schema: contracts.usageEventCorrectionResponseSchema,
  },
  UsageEventListResponse: { mode: "output", schema: contracts.usageEventListResponseSchema },
  UsageEventRequest: { mode: "input", schema: contracts.usageEventSchema },
  UsageEventResponse: { mode: "output", schema: contracts.usageEventResponseSchema },
  UsageTimeseriesResponse: { mode: "output", schema: contracts.usageTimeseriesResponseSchema },
  UsageTotalResponse: { mode: "output", schema: contracts.usageTotalResponseSchema },
} satisfies Record<string, ComponentDefinition>;

const pageQuery = contracts.cursorPaginationQuerySchema;

const operations: readonly OperationDefinition[] = [
  {
    method: "get",
    path: "/",
    responseContentType: "text/plain",
    security: "public",
    summary: "Identify the API service",
    tag: "System",
  },
  {
    method: "get",
    path: "/health",
    response: "HealthResponse",
    security: "public",
    status: 200,
    summary: "Check API and PostgreSQL health",
    tag: "System",
  },
  {
    method: "get",
    path: "/openapi.json",
    security: "public",
    summary: "Download this OpenAPI document",
    tag: "System",
  },

  {
    method: "get",
    path: "/v1/organizations",
    query: pageQuery,
    response: "OrganizationListResponse",
    security: "session",
    summary: "List organizations for the current user",
    tag: "Organizations",
  },
  {
    body: "CreateOrganizationRequest",
    method: "post",
    path: "/v1/organizations",
    response: "CreateOrganizationResponse",
    security: "session",
    status: 201,
    summary: "Create an organization",
    tag: "Organizations",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId",
    response: "OrganizationDetailResponse",
    security: "session",
    summary: "Get an organization and membership",
    tag: "Organizations",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/members",
    query: pageQuery,
    response: "OrganizationMembershipListResponse",
    security: "session",
    summary: "List organization members",
    tag: "Organizations",
  },
  {
    body: "AddOrganizationMemberRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/members",
    response: "OrganizationMembershipMutationResponse",
    security: "session",
    status: 201,
    summary: "Add an organization member",
    tag: "Organizations",
  },
  {
    body: "UpdateOrganizationMemberRequest",
    method: "patch",
    path: "/v1/organizations/:organizationId/members/:userId",
    response: "OrganizationMembershipMutationResponse",
    security: "session",
    summary: "Change a member role",
    tag: "Organizations",
  },
  {
    method: "delete",
    path: "/v1/organizations/:organizationId/members/:userId",
    response: "OrganizationMembershipRemovalResponse",
    security: "session",
    summary: "Remove an organization member",
    tag: "Organizations",
  },

  {
    method: "get",
    path: "/v1/organizations/:organizationId/api-keys",
    query: pageQuery,
    response: "ApiKeyListResponse",
    security: "session",
    summary: "List API keys",
    tag: "API keys",
  },
  {
    body: "CreateApiKeyRequest",
    description: "The plaintext key is returned once and must be stored immediately.",
    method: "post",
    path: "/v1/organizations/:organizationId/api-keys",
    response: "RevealedApiKeyResponse",
    security: "session",
    status: 201,
    summary: "Create an API key",
    tag: "API keys",
  },
  {
    description: "The replacement plaintext key is returned once.",
    method: "post",
    path: "/v1/organizations/:organizationId/api-keys/:apiKeyId/rotate",
    response: "RevealedApiKeyResponse",
    security: "session",
    status: 201,
    summary: "Rotate an API key",
    tag: "API keys",
  },
  {
    method: "post",
    path: "/v1/organizations/:organizationId/api-keys/:apiKeyId/revoke",
    response: "RevokedApiKeyResponse",
    security: "session",
    summary: "Revoke an API key",
    tag: "API keys",
  },

  {
    method: "get",
    path: "/v1/organizations/:organizationId/customers",
    query: contracts.customerListQuerySchema,
    response: "CustomerListResponse",
    security: "session",
    summary: "List customers",
    tag: "Customers",
  },
  {
    body: "CreateCustomerRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/customers",
    response: "CustomerMutationResponse",
    security: "session",
    status: 201,
    summary: "Create a customer",
    tag: "Customers",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/customers/:customerKey",
    response: "CustomerDetailResponse",
    security: "session",
    summary: "Get a customer",
    tag: "Customers",
  },
  {
    body: "AttachCustomerSubjectRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/customers/:customerKey/subjects",
    response: "CustomerSubjectMutationResponse",
    security: "session",
    status: 201,
    summary: "Attach a subject to a customer",
    tag: "Customers",
  },

  {
    method: "get",
    path: "/v1/organizations/:organizationId/plans",
    query: pageQuery,
    response: "PlanListResponse",
    security: "session",
    summary: "List plans",
    tag: "Catalog",
  },
  {
    body: "CreatePlanRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/plans",
    response: "PlanMutationResponse",
    security: "session",
    status: 201,
    summary: "Create a plan",
    tag: "Catalog",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/plans/:planKey",
    response: "PlanDetailResponse",
    security: "session",
    summary: "Get a plan and all versions",
    tag: "Catalog",
  },
  {
    body: "CreatePlanVersionRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/plans/:planKey/versions",
    response: "PlanVersionMutationResponse",
    security: "session",
    status: 201,
    summary: "Create a draft plan version",
    tag: "Catalog",
  },
  {
    method: "post",
    path: "/v1/organizations/:organizationId/plans/:planKey/versions/:version/publish",
    response: "PlanVersionMutationResponse",
    security: "session",
    summary: "Publish a plan version",
    tag: "Catalog",
  },
  {
    body: "DuplicatePlanVersionRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/plans/:planKey/versions/:version/duplicate",
    response: "PlanVersionMutationResponse",
    security: "session",
    status: 201,
    summary: "Duplicate a published plan version",
    tag: "Catalog",
  },
  {
    method: "post",
    path: "/v1/organizations/:organizationId/plans/:planKey/versions/:version/archive",
    response: "PlanVersionMutationResponse",
    security: "session",
    summary: "Archive a plan version",
    tag: "Catalog",
  },
  {
    method: "post",
    path: "/v1/organizations/:organizationId/plans/:planKey/archive",
    response: "PlanMutationResponse",
    security: "session",
    summary: "Archive a plan",
    tag: "Catalog",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/subscriptions",
    query: pageQuery,
    response: "SubscriptionListResponse",
    security: "session",
    summary: "List subscriptions",
    tag: "Catalog",
  },
  {
    body: "CreateSubscriptionRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/subscriptions",
    response: "SubscriptionMutationResponse",
    security: "session",
    status: 201,
    summary: "Create a subscription",
    tag: "Catalog",
  },
  {
    body: "CancelSubscriptionRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/subscriptions/:subscriptionId/cancel",
    response: "SubscriptionMutationResponse",
    security: "session",
    summary: "Schedule subscription cancellation",
    tag: "Catalog",
  },

  {
    method: "get",
    path: "/v1/organizations/:organizationId/features",
    query: contracts.featureListQuerySchema,
    response: "FeatureListResponse",
    security: "session",
    summary: "List entitlement features",
    tag: "Entitlements",
  },
  {
    body: "CreateFeatureRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/features",
    response: "FeatureMutationResponse",
    security: "session",
    status: 201,
    summary: "Create an entitlement feature",
    tag: "Entitlements",
  },
  {
    body: "ConfigureEntitlementRequest",
    method: "put",
    path: "/v1/organizations/:organizationId/customers/:customerKey/entitlements/:featureKey",
    response: "EntitlementResponse",
    security: "session",
    status: 201,
    summary: "Configure a customer entitlement",
    tag: "Entitlements",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/customers/:customerKey/entitlements/:featureKey",
    response: "EntitlementResponse",
    security: "session",
    summary: "Get a live entitlement balance",
    tag: "Entitlements",
  },
  {
    body: "CreateQuotaGrantRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/customers/:customerKey/entitlements/:featureKey/grants",
    response: "QuotaGrantMutationResponse",
    security: "session",
    status: 201,
    summary: "Grant quota",
    tag: "Entitlements",
  },
  {
    body: "CreateQuotaReservationRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/customers/:customerKey/reservations",
    response: "QuotaReservationMutationResponse",
    security: "session",
    status: 201,
    summary: "Reserve customer quota",
    tag: "Entitlements",
  },
  {
    body: "CommitQuotaReservationRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/reservations/:reservationId/commit",
    response: "QuotaReservationMutationResponse",
    security: "session",
    summary: "Commit a quota reservation",
    tag: "Entitlements",
  },
  {
    method: "post",
    path: "/v1/organizations/:organizationId/reservations/:reservationId/release",
    response: "QuotaReservationMutationResponse",
    security: "session",
    summary: "Release a quota reservation",
    tag: "Entitlements",
  },
  {
    body: "CreateQuotaReservationRequest",
    method: "post",
    path: "/v1/customers/:customerKey/reservations",
    response: "QuotaReservationMutationResponse",
    scopes: ["reservations:write"],
    security: "apiKey",
    status: 201,
    summary: "Reserve quota with an API key",
    tag: "Entitlements",
  },
  {
    body: "CommitQuotaReservationRequest",
    method: "post",
    path: "/v1/reservations/:reservationId/commit",
    response: "QuotaReservationMutationResponse",
    scopes: ["reservations:write"],
    security: "apiKey",
    summary: "Commit quota with an API key",
    tag: "Entitlements",
  },
  {
    method: "post",
    path: "/v1/reservations/:reservationId/release",
    response: "QuotaReservationMutationResponse",
    scopes: ["reservations:write"],
    security: "apiKey",
    summary: "Release quota with an API key",
    tag: "Entitlements",
  },

  {
    method: "get",
    path: "/v1/organizations/:organizationId/meters",
    query: pageQuery,
    response: "MeterListResponse",
    security: "session",
    summary: "List meters",
    tag: "Meters",
  },
  {
    body: "CreateMeterRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/meters",
    response: "MeterMutationResponse",
    security: "session",
    status: 201,
    summary: "Create a meter",
    tag: "Meters",
  },
  {
    body: "CreateMeterVersionRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/meters/:meterKey/versions",
    response: "MeterVersionMutationResponse",
    security: "session",
    status: 201,
    summary: "Create a meter version",
    tag: "Meters",
  },
  {
    method: "post",
    path: "/v1/organizations/:organizationId/meters/:meterKey/versions/:version/publish",
    response: "MeterPublishResponse",
    security: "session",
    summary: "Publish a meter version",
    tag: "Meters",
  },
  {
    method: "post",
    path: "/v1/organizations/:organizationId/meters/:meterKey/archive",
    response: "MeterMutationResponse",
    security: "session",
    summary: "Archive a meter",
    tag: "Meters",
  },

  {
    body: "UsageEventRequest",
    method: "post",
    path: "/v1/events",
    response: "EventIngestionResponse",
    scopes: ["events:write"],
    security: "apiKey",
    status: 202,
    summary: "Ingest one usage event",
    tag: "Events",
  },
  {
    body: "EventBatchRequest",
    method: "post",
    path: "/v1/events/batch",
    response: "EventIngestionResponse",
    scopes: ["events:write"],
    security: "apiKey",
    status: 202,
    summary: "Ingest a batch of usage events",
    tag: "Events",
  },
  {
    body: "UsageEventCorrectionRequest",
    method: "post",
    path: "/v1/events/:eventKey/corrections",
    response: "UsageEventCorrectionResponse",
    scopes: ["events:write"],
    security: "apiKey",
    status: 202,
    summary: "Reverse or replace a usage event",
    tag: "Events",
  },
  {
    method: "get",
    path: "/v1/events/:eventKey",
    response: "UsageEventResponse",
    scopes: ["events:read"],
    security: "apiKey",
    summary: "Get a usage event with an API key",
    tag: "Events",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/events",
    query: contracts.usageEventListQuerySchema,
    response: "UsageEventListResponse",
    security: "session",
    summary: "Explore organization usage events",
    tag: "Events",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/events/:eventKey",
    response: "UsageEventResponse",
    security: "session",
    summary: "Get an organization usage event",
    tag: "Events",
  },

  {
    method: "get",
    path: "/v1/usage",
    query: contracts.usageQuerySchema,
    response: "UsageTotalResponse",
    scopes: ["usage:read"],
    security: "apiKey",
    summary: "Get aggregate usage",
    tag: "Usage",
  },
  {
    method: "get",
    path: "/v1/usage/timeseries",
    query: contracts.usageQuerySchema,
    response: "UsageTimeseriesResponse",
    scopes: ["usage:read"],
    security: "apiKey",
    summary: "Get hourly usage timeseries",
    tag: "Usage",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/usage",
    query: contracts.usageQuerySchema,
    response: "UsageTotalResponse",
    security: "session",
    summary: "Get organization aggregate usage from the dashboard",
    tag: "Usage",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/usage/timeseries",
    query: contracts.usageQuerySchema,
    response: "UsageTimeseriesResponse",
    security: "session",
    summary: "Get organization hourly usage timeseries from the dashboard",
    tag: "Usage",
  },

  {
    method: "get",
    path: "/v1/organizations/:organizationId/invoice-previews",
    query: contracts.invoicePreviewListQuerySchema,
    response: "InvoicePreviewListResponse",
    security: "session",
    summary: "List latest invoice-preview revisions",
    tag: "Invoice previews",
  },
  {
    body: "CreateInvoicePreviewRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/invoice-previews",
    response: "InvoicePreviewMutationResponse",
    security: "session",
    status: 202,
    summary: "Queue an invoice preview",
    tag: "Invoice previews",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/invoice-previews/:previewId",
    response: "InvoicePreviewResponse",
    security: "session",
    summary: "Get the latest preview revision",
    tag: "Invoice previews",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/invoice-previews/:previewId/revisions",
    query: pageQuery,
    response: "InvoicePreviewRevisionListResponse",
    security: "session",
    summary: "List preview revisions",
    tag: "Invoice previews",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/invoice-previews/:previewId/revisions/:revision",
    response: "InvoicePreviewResponse",
    security: "session",
    summary: "Get a specific preview revision",
    tag: "Invoice previews",
  },

  {
    method: "get",
    path: "/v1/organizations/:organizationId/simulations",
    query: contracts.simulationListQuerySchema,
    response: "SimulationListResponse",
    security: "session",
    summary: "List pricing simulations",
    tag: "Simulations",
  },
  {
    body: "CreateSimulationRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/simulations",
    response: "SimulationMutationResponse",
    security: "session",
    status: 202,
    summary: "Queue a pricing simulation",
    tag: "Simulations",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/simulations/:simulationId",
    response: "SimulationResponse",
    security: "session",
    summary: "Get a pricing simulation",
    tag: "Simulations",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/simulations/:simulationId/customers",
    query: contracts.simulationResultListQuerySchema,
    response: "SimulationResultListResponse",
    security: "session",
    summary: "List per-customer simulation results",
    tag: "Simulations",
  },
  {
    description: "Returns JSON or CSV according to the required format query parameter.",
    method: "get",
    path: "/v1/organizations/:organizationId/simulations/:simulationId/report",
    query: contracts.simulationReportQuerySchema,
    response: "SimulationReportResponse",
    security: "session",
    summary: "Download a simulation report",
    tag: "Simulations",
  },

  {
    method: "get",
    path: "/v1/organizations/:organizationId/reconciliation-runs",
    query: contracts.reconciliationRunListQuerySchema,
    response: "ReconciliationRunListResponse",
    security: "session",
    summary: "List reconciliation and replay runs",
    tag: "Operations",
  },
  {
    body: "CreateReconciliationRunRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/reconciliation-runs",
    response: "ReconciliationRunMutationResponse",
    security: "session",
    status: 202,
    summary: "Queue reconciliation",
    tag: "Operations",
  },
  {
    body: "CreateReplayRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/replays",
    response: "ReconciliationRunMutationResponse",
    security: "session",
    status: 202,
    summary: "Queue a usage replay",
    tag: "Operations",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/reconciliation-runs/:runId",
    response: "ReconciliationRunResponse",
    security: "session",
    summary: "Get a reconciliation run",
    tag: "Operations",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/reconciliation-runs/:runId/findings",
    query: pageQuery,
    response: "ReconciliationFindingListResponse",
    security: "session",
    summary: "List reconciliation findings",
    tag: "Operations",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/audit-log",
    query: contracts.auditLogQuerySchema,
    response: "AuditLogListResponse",
    security: "session",
    summary: "List immutable audit entries",
    tag: "Operations",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/exports",
    query: contracts.billingExportListQuerySchema,
    response: "BillingExportListResponse",
    security: "session",
    summary: "List billing exports",
    tag: "Exports",
  },
  {
    body: "CreateStripeInvoiceLineExportRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/exports/stripe/invoice-lines",
    response: "BillingExportMutationResponse",
    security: "session",
    status: 202,
    summary: "Queue a Stripe invoice-line export",
    tag: "Exports",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/exports/:exportId",
    response: "BillingExportResponse",
    security: "session",
    summary: "Get billing-export status",
    tag: "Exports",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/exports/:exportId/download",
    response: "StripeInvoiceLineExportFile",
    security: "session",
    summary: "Download a completed billing export",
    tag: "Exports",
  },

  {
    method: "get",
    path: "/v1/organizations/:organizationId/retention-policy",
    response: "RetentionPolicyResponse",
    security: "session",
    summary: "Get event-property retention policy",
    tag: "Retention",
  },
  {
    body: "UpdateRetentionPolicyRequest",
    method: "put",
    path: "/v1/organizations/:organizationId/retention-policy",
    response: "RetentionPolicyMutationResponse",
    security: "session",
    status: 202,
    summary: "Update retention policy",
    tag: "Retention",
  },

  {
    method: "get",
    path: "/v1/organizations/:organizationId/failed-jobs",
    query: contracts.failedJobListQuerySchema,
    response: "FailedJobListResponse",
    security: "session",
    summary: "List failed jobs",
    tag: "Failed jobs",
  },
  {
    method: "get",
    path: "/v1/organizations/:organizationId/failed-jobs/:jobId",
    response: "FailedJobResponse",
    security: "session",
    summary: "Inspect a failed job",
    tag: "Failed jobs",
  },
  {
    body: "RetryFailedJobRequest",
    method: "post",
    path: "/v1/organizations/:organizationId/failed-jobs/:jobId/retry",
    response: "RetryFailedJobResponse",
    security: "session",
    status: 202,
    summary: "Retry an exhausted transient failure",
    tag: "Failed jobs",
  },
];

const PATH_UUID_PARAMETERS = new Set([
  "apiKeyId",
  "exportId",
  "jobId",
  "organizationId",
  "previewId",
  "reservationId",
  "runId",
  "simulationId",
  "subscriptionId",
  "userId",
]);

function jsonSchema(schema: z.ZodType, mode: SchemaMode): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, { io: mode });
  const { $schema: _, ...value } = converted;
  return value;
}

function componentReference(name: keyof typeof componentDefinitions) {
  return { $ref: `#/components/schemas/${name}` };
}

function pathParameters(path: string): readonly Record<string, unknown>[] {
  return [...path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map((match) => {
    const name = match[1] ?? "parameter";
    const numeric = name === "revision" || name === "version";
    return {
      in: "path",
      name,
      required: true,
      schema: numeric
        ? { minimum: 1, type: "integer" }
        : PATH_UUID_PARAMETERS.has(name)
          ? { format: "uuid", type: "string" }
          : { minLength: 1, type: "string" },
    };
  });
}

function queryParameters(schema?: z.ZodType): readonly Record<string, unknown>[] {
  if (!schema) return [];
  const converted = jsonSchema(schema, "input");
  const properties = converted.properties;
  if (!properties || typeof properties !== "object") return [];
  const required = new Set(Array.isArray(converted.required) ? converted.required : []);
  return Object.entries(properties).map(([name, parameterSchema]) => ({
    in: "query",
    name,
    required: required.has(name),
    schema: parameterSchema,
  }));
}

function openApiPath(path: string): string {
  return path.replaceAll(/:([A-Za-z][A-Za-z0-9]*)/g, "{$1}");
}

function operationSecurity(operation: OperationDefinition) {
  if (operation.security === "public") return [];
  return operation.security === "session" ? [{ sessionCookie: [] }] : [{ bearerApiKey: [] }];
}

function responseObject(operation: OperationDefinition) {
  if (operation.path.endsWith("/simulations/:simulationId/report")) {
    return {
      content: {
        "application/json": { schema: componentReference("SimulationReportResponse") },
        "text/csv": { schema: { type: "string" } },
      },
      description: "Completed simulation report in the requested format.",
    };
  }
  const contentType = operation.responseContentType ?? "application/json";
  const schema = operation.response
    ? componentReference(operation.response)
    : contentType === "text/plain"
      ? { type: "string" }
      : {};
  return {
    content: { [contentType]: { schema } },
    description: operation.responseDescription ?? "Successful response.",
  };
}

function buildPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operations) {
    const path = openApiPath(operation.path);
    const parameters = [
      ...pathParameters(operation.path),
      ...queryParameters(operation.query),
      {
        description: "Optional caller-supplied correlation identifier.",
        in: "header",
        name: "X-Request-Id",
        required: false,
        schema: { maxLength: 128, type: "string" },
      },
      ...(operation.security === "session" && operation.method !== "get"
        ? [
            {
              description:
                "Must match an allowed application origin for cookie-authenticated mutations.",
              in: "header",
              name: "Origin",
              required: true,
              schema: { format: "uri", type: "string" },
            },
          ]
        : []),
    ];
    const responses: Record<string, unknown> = {
      [String(operation.status ?? 200)]: responseObject(operation),
    };
    if (operation.path === "/health") {
      responses["503"] = {
        content: { "application/json": { schema: componentReference("HealthResponse") } },
        description: "PostgreSQL is unavailable.",
      };
    }
    if (operation.path.startsWith("/v1/")) {
      for (const [status, description] of [
        ["400", "The request is invalid."],
        ["401", "Authentication failed."],
        ["403", "The principal lacks permission."],
        ["404", "The tenant-scoped resource was not found."],
        ["409", "The operation conflicts with current state."],
        ["413", "The request payload is too large."],
        ["429", "The credential rate limit was exceeded."],
        ["500", "An unexpected internal error occurred."],
      ] as const) {
        responses[status] = {
          content: { "application/json": { schema: componentReference("PublicError") } },
          description,
        };
      }
    }
    const pathItem = paths[path] ?? {};
    pathItem[operation.method] = {
      ...(operation.description ? { description: operation.description } : {}),
      operationId: `${operation.method}_${operation.path}`
        .replaceAll(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_|_$/g, ""),
      parameters,
      ...(operation.body
        ? {
            requestBody: {
              content: {
                "application/json": { schema: componentReference(operation.body) },
              },
              required: true,
            },
          }
        : {}),
      responses,
      security: operationSecurity(operation),
      summary: operation.summary,
      tags: [operation.tag],
      ...(operation.scopes ? { "x-required-scopes": operation.scopes } : {}),
    };
    paths[path] = pathItem;
  }
  return paths;
}

export function createOpenApiDocument() {
  return {
    components: {
      schemas: Object.fromEntries(
        Object.entries(componentDefinitions).map(([name, definition]) => [
          name,
          jsonSchema(definition.schema, definition.mode),
        ]),
      ),
      securitySchemes: {
        bearerApiKey: {
          bearerFormat: "MeterPilot API key",
          description: "Use `Authorization: Bearer mpk_<prefix>.<secret>`.",
          scheme: "bearer",
          type: "http",
        },
        sessionCookie: {
          description:
            "Better Auth browser session cookie. The secure cookie name may be environment-prefixed.",
          in: "cookie",
          name: "better-auth.session_token",
          type: "apiKey",
        },
      },
    },
    info: {
      description:
        "Tenant-isolated usage metering, entitlements, pricing previews, simulations, reconciliation, and billing-export API. Browser-session mutations require a matching Origin header. API-key operations declare their required scope with x-required-scopes.",
      title: "MeterPilot API",
      version: "0.1.0",
    },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    openapi: "3.1.0",
    paths: buildPaths(),
    servers: [{ description: "Current MeterPilot server", url: "/" }],
    tags: [...new Set(operations.map((operation) => operation.tag))].map((name) => ({ name })),
  } as const;
}

export const openApiDocument = createOpenApiDocument();

export const documentedOperations = operations.map((operation) => ({
  method: operation.method.toUpperCase(),
  path: operation.path,
}));
