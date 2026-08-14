import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "./utils";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<StatusTone, string> = {
  danger: "bg-mp-danger-soft text-mp-danger",
  info: "bg-mp-info-soft text-mp-info",
  neutral: "bg-mp-paper text-mp-ink-muted",
  success: "bg-mp-success-soft text-mp-success",
  warning: "bg-mp-warning-soft text-mp-warning",
};

export interface StatusBadgeProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  children: ReactNode;
  tone?: StatusTone;
}

export function StatusBadge({ children, className, tone = "neutral", ...props }: StatusBadgeProps) {
  return (
    <span
      {...props}
      className={cx(
        "inline-flex w-fit items-center gap-1.5 rounded-full border border-mp-border px-2 py-1 font-mp-mono text-xs font-semibold leading-tight tracking-wider uppercase forced-colors:border-[CanvasText]",
        toneClasses[tone],
        className,
      )}
      data-tone={tone}
    >
      <span aria-hidden="true" className="size-2 rounded-full border border-current bg-current" />
      <span>{children}</span>
    </span>
  );
}
