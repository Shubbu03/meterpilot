import type {
  CreateMeterRequest,
  CreateMeterVersionRequest,
  Meter,
  MeterVersion,
} from "@meterpilot/contracts/meters";

import type { PageRequest, PageResult, TenantAuthorization } from "../organizations/repository";

export const REBUILD_USAGE_AGGREGATES_JOB_TYPE = "usage_aggregate.rebuild";

export type MeterMutationResult =
  | Readonly<{ meter: Meter; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export type MeterVersionMutationResult =
  | Readonly<{ meterVersion: MeterVersion; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export type MeterPublishResult =
  | Readonly<{ meterVersion: MeterVersion; rebuildJobId: string; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export type MeterRepository = Readonly<{
  archive: (
    tenant: TenantAuthorization,
    meterKey: string,
    requestId: string,
  ) => Promise<MeterMutationResult>;
  create: (
    tenant: TenantAuthorization,
    input: CreateMeterRequest,
    requestId: string,
  ) => Promise<MeterMutationResult>;
  createVersion: (
    tenant: TenantAuthorization,
    meterKey: string,
    input: CreateMeterVersionRequest,
    requestId: string,
  ) => Promise<MeterVersionMutationResult>;
  list: (tenant: TenantAuthorization, page: PageRequest) => Promise<PageResult<Meter>>;
  publish: (
    tenant: TenantAuthorization,
    meterKey: string,
    version: number,
    requestId: string,
  ) => Promise<MeterPublishResult>;
}>;
