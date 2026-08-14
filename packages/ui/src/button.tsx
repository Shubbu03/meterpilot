import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "compact" | "default";

const baseClasses =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-mp-sm border border-transparent font-mp-sans font-semibold leading-none transition enabled:hover:-translate-y-px enabled:active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-mp-warning disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none motion-reduce:enabled:hover:translate-y-0 forced-colors:border-[CanvasText]";

const sizeClasses: Record<ButtonSize, string> = {
  compact: "min-h-9 px-3 text-xs",
  default: "min-h-11 px-4 text-sm",
};

const variantClasses: Record<ButtonVariant, string> = {
  danger: "border-mp-danger bg-mp-danger text-white",
  ghost: "bg-transparent text-mp-ink enabled:hover:border-mp-border enabled:hover:bg-mp-paper",
  primary: "border-mp-signal-strong bg-mp-signal text-mp-ink",
  secondary: "border-mp-border bg-mp-panel text-mp-ink",
};

export interface ButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
  children: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export function Button({
  children,
  className,
  disabled = false,
  loading = false,
  loadingLabel = "Working…",
  size = "default",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={cx(baseClasses, sizeClasses[size], variantClasses[variant], className)}
      data-size={size}
      data-variant={variant}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
        />
      ) : null}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
}
