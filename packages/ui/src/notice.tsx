import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "./utils";

export type NoticeTone = "info" | "success" | "warning" | "danger";

const noticeToneClasses: Record<NoticeTone, string> = {
  danger: "border-mp-danger bg-mp-danger-soft",
  info: "border-mp-info bg-mp-info-soft",
  success: "border-mp-success bg-mp-success-soft",
  warning: "border-mp-warning bg-mp-warning-soft",
};

const markToneClasses: Record<NoticeTone, string> = {
  danger: "bg-mp-danger",
  info: "bg-mp-info",
  success: "bg-mp-success",
  warning: "bg-mp-warning",
};

export interface NoticeProps extends Omit<ComponentPropsWithoutRef<"aside">, "title"> {
  children: ReactNode;
  title: ReactNode;
  tone?: NoticeTone;
}

export function Notice({ children, className, role, title, tone = "info", ...props }: NoticeProps) {
  return (
    <aside
      {...props}
      className={cx(
        "grid grid-cols-[0.3rem_minmax(0,1fr)] gap-3 rounded-mp-sm border p-3.5 text-mp-ink forced-colors:border-[CanvasText]",
        noticeToneClasses[tone],
        className,
      )}
      data-tone={tone}
      role={role ?? (tone === "danger" ? "alert" : undefined)}
    >
      <div aria-hidden="true" className={cx("min-h-full rounded-full", markToneClasses[tone])} />
      <div>
        <p className="m-0 text-sm font-bold">{title}</p>
        <div className="mt-1 text-xs leading-relaxed text-mp-ink-muted [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          {children}
        </div>
      </div>
    </aside>
  );
}
