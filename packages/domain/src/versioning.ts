import { DomainInvariantError } from "./errors";
import type { Instant } from "./time";

export type VersionLifecycle =
  | Readonly<{ status: "draft" }>
  | Readonly<{ publishedAt: Instant; status: "published" }>
  | Readonly<{ archivedAt: Instant; publishedAt: Instant; status: "archived" }>;

export const draftVersion = (): VersionLifecycle => Object.freeze({ status: "draft" });

export function publishVersion(
  lifecycle: VersionLifecycle,
  publishedAt: Instant,
): VersionLifecycle {
  if (lifecycle.status !== "draft") {
    throw new DomainInvariantError(
      "invalid_state_transition",
      "Only a draft version can be published.",
    );
  }

  return Object.freeze({ publishedAt, status: "published" });
}

export function archiveVersion(lifecycle: VersionLifecycle, archivedAt: Instant): VersionLifecycle {
  if (lifecycle.status !== "published") {
    throw new DomainInvariantError(
      "invalid_state_transition",
      "Only a published version can be archived.",
    );
  }

  if (Date.parse(archivedAt) < Date.parse(lifecycle.publishedAt)) {
    throw new DomainInvariantError(
      "invalid_state_transition",
      "A version cannot be archived before it was published.",
    );
  }

  return Object.freeze({
    archivedAt,
    publishedAt: lifecycle.publishedAt,
    status: "archived",
  });
}

export function assertDraftVersion(lifecycle: VersionLifecycle): asserts lifecycle is Readonly<{
  status: "draft";
}> {
  if (lifecycle.status !== "draft") {
    throw new DomainInvariantError(
      "invalid_state_transition",
      "Published and archived versions are immutable.",
    );
  }
}
