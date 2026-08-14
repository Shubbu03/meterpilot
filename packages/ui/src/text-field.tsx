import { type ComponentPropsWithoutRef, useId } from "react";
import { cx } from "./utils";

export interface TextFieldProps extends Omit<ComponentPropsWithoutRef<"input">, "size"> {
  error?: string;
  hint?: string;
  label: string;
}

export function TextField({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  className,
  error,
  hint,
  id,
  label,
  required = false,
  type = "text",
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [ariaDescribedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-1.5 font-mp-sans text-mp-ink">
      <label
        className="flex items-baseline justify-between gap-4 text-sm font-semibold"
        htmlFor={inputId}
      >
        <span>{label}</span>
        {required ? (
          <span className="font-mp-mono text-xs tracking-wider text-mp-ink-muted uppercase">
            Required
          </span>
        ) : null}
      </label>
      {hint ? (
        <p className="m-0 text-xs leading-relaxed text-mp-ink-muted" id={hintId}>
          {hint}
        </p>
      ) : null}
      <input
        {...props}
        aria-describedby={describedBy}
        aria-invalid={error ? true : ariaInvalid}
        className={cx(
          "min-h-11 w-full rounded-mp-sm border border-mp-border bg-mp-panel px-3 py-2.5 text-mp-ink placeholder:text-mp-ink-muted/75 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-mp-warning disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-mp-danger aria-invalid:bg-mp-danger-soft forced-colors:border-[CanvasText]",
          className,
        )}
        id={inputId}
        required={required}
        type={type}
      />
      {error ? (
        <p
          className="m-0 text-xs font-semibold leading-relaxed text-mp-danger"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
