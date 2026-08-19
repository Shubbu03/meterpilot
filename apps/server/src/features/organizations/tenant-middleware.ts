import { createMiddleware } from "hono/factory";

import type { AppEnvironment } from "../../http/environment";
import { publicError } from "../../http/public-errors";
import type { OrganizationRepository } from "./repository";

export function createTenantMiddleware(repository: OrganizationRepository) {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const session = context.get("authenticatedSession");
    const organizationId = context.req.param("organizationId");

    if (!organizationId) {
      return publicError(context, 400, "validation_error", "An organization ID is required.");
    }

    const tenant = await repository.resolveTenant(session.user.id, organizationId);

    if (!tenant) {
      return publicError(context, 403, "forbidden", "You do not have access to this organization.");
    }

    context.set("tenant", tenant);
    await next();
  });
}
