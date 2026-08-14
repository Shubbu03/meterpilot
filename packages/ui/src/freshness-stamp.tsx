import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "./utils";

export interface FreshnessStampProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  children: ReactNode;
  dateTime: string;
  label?: ReactNode;
}

export function FreshnessStamp({
  children,
  className,
  dateTime,
  label = "Updated",
  ...props
}: FreshnessStampProps) {
  return (
    <span
      {...props}
      className={cx(
        "inline-flex items-center gap-1.5 font-mp-mono text-xs font-semibold leading-tight tracking-wider text-mp-ink-muted uppercase",
        className,
      )}
    >
      <span>{label}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={dateTime}>{children}</time>
    </span>
  );
}
