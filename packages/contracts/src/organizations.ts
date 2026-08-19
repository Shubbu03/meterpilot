import { z } from "zod";

import { createCursorPageSchema, requestIdSchema } from "./common";

const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const organizationIdSchema = z.uuid();
export const userIdSchema = z.uuid();
export const organizationMembershipRoleSchema = z.enum([
  "owner",
  "admin",
  "developer",
  "analyst",
  "support",
]);

export const organizationSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(ORGANIZATION_SLUG_PATTERN, "must be a lowercase URL-safe slug");

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "must be a valid IANA timezone");

export const createOrganizationRequestSchema = z.strictObject({
  defaultTimezone: timezoneSchema.default("UTC"),
  name: z.string().trim().min(1).max(200),
  slug: organizationSlugSchema,
});

export const organizationSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  defaultTimezone: timezoneSchema,
  id: organizationIdSchema,
  name: z.string().min(1).max(200),
  slug: organizationSlugSchema,
});

export const organizationMembershipSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  role: organizationMembershipRoleSchema,
  user: z.strictObject({
    email: z.email(),
    id: userIdSchema,
    name: z.string().min(1).max(200),
  }),
});

export const createOrganizationResponseSchema = z.strictObject({
  membership: organizationMembershipSchema,
  organization: organizationSchema,
  requestId: requestIdSchema,
});

export const organizationDetailResponseSchema = z.strictObject({
  membership: organizationMembershipSchema,
  organization: organizationSchema,
});

export const organizationListItemSchema = z.strictObject({
  membership: organizationMembershipSchema,
  organization: organizationSchema,
});

export const organizationListResponseSchema = createCursorPageSchema(organizationListItemSchema);

export const organizationIdParamSchema = z.strictObject({
  organizationId: organizationIdSchema,
});

export const organizationMemberParamSchema = z.strictObject({
  organizationId: organizationIdSchema,
  userId: userIdSchema,
});

export const addOrganizationMemberRequestSchema = z.strictObject({
  email: z.email().transform((email) => email.toLowerCase()),
  role: organizationMembershipRoleSchema,
});

export const updateOrganizationMemberRequestSchema = z.strictObject({
  role: organizationMembershipRoleSchema,
});

export const organizationMembershipListResponseSchema = createCursorPageSchema(
  organizationMembershipSchema,
);

export const organizationMembershipMutationResponseSchema = z.strictObject({
  membership: organizationMembershipSchema,
  requestId: requestIdSchema,
});

export const organizationMembershipRemovalResponseSchema = z.strictObject({
  requestId: requestIdSchema,
});

export type AddOrganizationMemberRequest = z.output<typeof addOrganizationMemberRequestSchema>;
export type CreateOrganizationRequest = z.output<typeof createOrganizationRequestSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type OrganizationListItem = z.infer<typeof organizationListItemSchema>;
export type OrganizationMembership = z.infer<typeof organizationMembershipSchema>;
export type OrganizationMembershipRole = z.infer<typeof organizationMembershipRoleSchema>;
export type UpdateOrganizationMemberRequest = z.output<
  typeof updateOrganizationMemberRequestSchema
>;
