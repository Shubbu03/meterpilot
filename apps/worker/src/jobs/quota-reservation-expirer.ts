export type QuotaReservationExpiryResult =
  | Readonly<{ status: "expired" | "terminal" }>
  | Readonly<{ expiresAt: Date; status: "not_due" }>
  | Readonly<{ status: "not_found" }>;

export type QuotaReservationExpirer = Readonly<{
  expire: (
    organizationId: string,
    reservationId: string,
    at: Date,
    signal: AbortSignal,
  ) => Promise<QuotaReservationExpiryResult>;
}>;
