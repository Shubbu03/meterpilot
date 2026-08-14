import { type ComponentPropsWithoutRef, type ReactNode, useId } from "react";
import { cx } from "./utils";

export interface EmptyStateProps extends Omit<ComponentPropsWithoutRef<"section">, "title"> {
  action?: ReactNode;
  description: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
}

export function EmptyState({
  action,
  className,
  description,
  eyebrow = "Nothing here yet",
  title,
  ...props
}: EmptyStateProps) {
  const titleId = useId();

  return (
    <section
      {...props}
      aria-labelledby={titleId}
      className={cx(
        "mp-empty-state-frame grid justify-items-start rounded-mp-md p-5 text-mp-ink sm:p-8 forced-colors:border-[CanvasText]",
        className,
      )}
    >
      <p className="m-0 font-mp-mono text-xs font-semibold tracking-widest text-mp-ink-muted uppercase">
        {eyebrow}
      </p>
      <h2
        className="mt-2 mb-0 max-w-xl font-mp-display text-2xl leading-tight tracking-tight sm:text-4xl"
        id={titleId}
      >
        {title}
      </h2>
      <div className="mt-2.5 max-w-2xl text-sm leading-relaxed text-mp-ink-muted">
        {description}
      </div>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}
