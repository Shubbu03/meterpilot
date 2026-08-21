import {
  ChartLineIcon,
  ClockCounterClockwiseIcon,
  ExportIcon,
  FileTextIcon,
  FlagIcon,
  FlaskIcon,
  GaugeIcon,
  type Icon,
  KeyIcon,
  PulseIcon,
  ReceiptIcon,
  ScalesIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
  StackIcon,
  UserListIcon,
  UsersThreeIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";

export interface NavigationItem {
  icon: Icon;
  label: string;
  to: string;
}

export interface NavigationSection {
  items: readonly NavigationItem[];
  label: string;
}

export const navigationSections: readonly NavigationSection[] = [
  {
    items: [
      { icon: SquaresFourIcon, label: "Overview", to: "/" },
      { icon: PulseIcon, label: "Events", to: "/events" },
      { icon: ChartLineIcon, label: "Usage", to: "/usage" },
      { icon: UsersThreeIcon, label: "Customers", to: "/customers" },
    ],
    label: "Operate",
  },
  {
    items: [
      { icon: GaugeIcon, label: "Meters", to: "/meters" },
      { icon: FlagIcon, label: "Features", to: "/features" },
      { icon: StackIcon, label: "Plans", to: "/plans" },
      { icon: ReceiptIcon, label: "Subscriptions", to: "/subscriptions" },
    ],
    label: "Configure",
  },
  {
    items: [
      { icon: FileTextIcon, label: "Invoice previews", to: "/previews" },
      { icon: FlaskIcon, label: "Simulations", to: "/simulations" },
      { icon: ScalesIcon, label: "Reconciliation", to: "/reconciliation" },
    ],
    label: "Verify",
  },
  {
    items: [
      { icon: KeyIcon, label: "API keys", to: "/api-keys" },
      { icon: ExportIcon, label: "Exports", to: "/exports" },
      { icon: ClockCounterClockwiseIcon, label: "Audit log", to: "/audit-log" },
      { icon: WarningOctagonIcon, label: "Failed jobs", to: "/failed-jobs" },
      { icon: ShieldCheckIcon, label: "Retention", to: "/retention" },
      { icon: UserListIcon, label: "Members", to: "/members" },
    ],
    label: "Administration",
  },
] as const;
