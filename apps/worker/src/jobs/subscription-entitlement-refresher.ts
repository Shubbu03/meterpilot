export type SubscriptionEntitlementRefreshResult = Readonly<{
  status: "conflict" | "not_found" | "refreshed" | "terminal";
}>;

export type SubscriptionEntitlementRefresher = Readonly<{
  refresh: (
    organizationId: string,
    subscriptionId: string,
    periodStart: Date,
    requestId: string,
    signal: AbortSignal,
  ) => Promise<SubscriptionEntitlementRefreshResult>;
}>;
