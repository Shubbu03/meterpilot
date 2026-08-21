import type {
  UsageFreshness,
  UsageQuery,
  UsageTimeseriesPoint,
  UsageTotal,
} from "@meterpilot/contracts/usage";

export type UsageTotalResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "ok"; usage: UsageTotal }>;

export type UsageTimeseriesResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      customerKey: string;
      freshness: UsageFreshness | null;
      from: string;
      meterKey: string;
      points: readonly UsageTimeseriesPoint[];
      status: "ok";
      to: string;
    }>;

export type UsageRepository = Readonly<{
  getTimeseries: (organizationId: string, query: UsageQuery) => Promise<UsageTimeseriesResult>;
  getTotal: (organizationId: string, query: UsageQuery) => Promise<UsageTotalResult>;
}>;
