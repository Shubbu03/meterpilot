import type { ComponentPropsWithoutRef } from "react";
import { cx } from "./utils";

export function Panel({ className, ...props }: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      {...props}
      className={cx(
        "overflow-clip rounded-mp-md border border-mp-border bg-mp-panel text-mp-ink shadow-mp-raised forced-colors:border-[CanvasText]",
        className,
      )}
    />
  );
}

export function PanelHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={cx("border-b border-mp-border px-4 py-4", className)} />;
}

export interface PanelTitleProps extends ComponentPropsWithoutRef<"h2"> {
  as?: "h2" | "h3" | "h4";
}

export function PanelTitle({ as: Heading = "h2", className, ...props }: PanelTitleProps) {
  return (
    <Heading
      {...props}
      className={cx(
        "m-0 font-mp-display text-xl font-semibold leading-tight tracking-tight",
        className,
      )}
    />
  );
}

export function PanelDescription({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      {...props}
      className={cx("mt-1.5 mb-0 text-sm leading-relaxed text-mp-ink-muted", className)}
    />
  );
}

export function PanelContent({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={cx("px-4 py-4", className)} />;
}

export function PanelFooter({ className, ...props }: ComponentPropsWithoutRef<"footer">) {
  return (
    <footer
      {...props}
      className={cx(
        "flex flex-wrap items-center gap-3 border-t border-mp-border px-4 py-4",
        className,
      )}
    />
  );
}
