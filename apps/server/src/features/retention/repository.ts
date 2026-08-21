import type {
  RetentionPolicy,
  UpdateRetentionPolicyRequest,
} from "@meterpilot/contracts/retention";

import type { TenantAuthorization } from "../organizations/repository";

export type RetentionPolicyMutationResult =
  | Readonly<{ jobId: string | null; policy: RetentionPolicy; status: "ok" }>
  | Readonly<{ status: "forbidden" }>;

export type RetentionRepository = Readonly<{
  findPolicy: (tenant: TenantAuthorization) => Promise<RetentionPolicy>;
  updatePolicy: (
    tenant: TenantAuthorization,
    input: UpdateRetentionPolicyRequest,
    requestId: string,
  ) => Promise<RetentionPolicyMutationResult>;
}>;
