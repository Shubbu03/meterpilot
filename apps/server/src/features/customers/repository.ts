import type {
  AttachCustomerSubjectRequest,
  CreateCustomerRequest,
  Customer,
  CustomerSubject,
} from "@meterpilot/contracts/customers";

import type { PageRequest, PageResult, TenantAuthorization } from "../organizations/repository";

export class InvalidCustomerCursorError extends Error {
  override readonly name = "InvalidCustomerCursorError";

  constructor() {
    super("The pagination cursor is invalid.");
  }
}

export type CustomerMutationResult =
  | Readonly<{ customer: Customer; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" }>;

export type CustomerSubjectMutationResult =
  | Readonly<{ status: "ok"; subject: CustomerSubject }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export type CustomerRepository = Readonly<{
  attachSubject: (
    tenant: TenantAuthorization,
    customerKey: string,
    input: AttachCustomerSubjectRequest,
    requestId: string,
  ) => Promise<CustomerSubjectMutationResult>;
  create: (
    tenant: TenantAuthorization,
    input: CreateCustomerRequest,
    requestId: string,
  ) => Promise<CustomerMutationResult>;
  find: (organizationId: string, customerKey: string) => Promise<Customer | null>;
  list: (tenant: TenantAuthorization, page: PageRequest) => Promise<PageResult<Customer>>;
}>;
