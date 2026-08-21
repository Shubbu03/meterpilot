import { Button, Notice, TextField } from "@meterpilot/ui";
import { CheckCircleIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { z } from "zod";

import { authClient } from "../../lib/auth/client";
import { firstFieldErrors } from "./form-errors";

const signInSchema = z.strictObject({
  email: z.email("Enter a valid email address.").transform((email) => email.toLowerCase()),
  password: z.string().min(1, "Enter your password.").max(128, "Password is too long."),
});

const signUpSchema = signInSchema.extend({
  name: z.string().trim().min(1, "Enter your name.").max(200, "Name is too long."),
  password: z.string().min(8, "Use at least 8 characters.").max(128, "Password is too long."),
});

type AuthMode = "sign-in" | "sign-up";

function safeReturnPath(state: unknown) {
  if (!state || typeof state !== "object" || !("from" in state)) {
    return "/";
  }

  const from = state.from;

  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
}

function sessionExpired(state: unknown) {
  return Boolean(
    state && typeof state === "object" && "reason" in state && state.reason === "expired",
  );
}

function AuthStory() {
  const checks = [
    "Usage facts remain immutable",
    "Every response keeps its request ID",
    "Organizations stay strictly isolated",
  ] as const;

  return (
    <aside className="relative overflow-hidden border-mp-border/30 border-b bg-mp-ink p-6 text-mp-paper lg:min-h-svh lg:border-r lg:border-b-0 lg:p-10 xl:p-14">
      <div className="absolute top-0 right-0 h-full w-2 bg-mp-signal" aria-hidden="true" />
      <Link
        aria-label="MeterPilot home"
        className="inline-flex min-h-11 items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mp-warning"
        to="/"
      >
        <span className="font-mp-display text-3xl font-semibold">MeterPilot</span>
        <span className="font-mp-mono text-[0.625rem] tracking-[0.2em] text-mp-signal uppercase">
          control
        </span>
      </Link>

      <div className="mt-12 max-w-xl lg:mt-[18vh]">
        <p className="font-mp-mono text-xs tracking-[0.2em] text-mp-signal uppercase">
          Pricing operations ledger
        </p>
        <h1 className="mt-4 font-mp-display text-[clamp(3rem,7vw,6.75rem)] leading-[0.88] font-semibold tracking-[-0.05em]">
          Trust the total.
          <br />
          Trace the reason.
        </h1>
        <p className="mt-6 max-w-lg text-sm leading-7 text-mp-border sm:text-base">
          Sign in to inspect usage, test pricing, and reconcile billing evidence without changing
          the authoritative ledger.
        </p>
      </div>

      <ul className="mt-10 grid gap-3 border-mp-border/30 border-t pt-6 lg:mt-16">
        {checks.map((check) => (
          <li className="flex items-center gap-3 text-sm" key={check}>
            <CheckCircleIcon
              aria-hidden="true"
              className="text-mp-signal"
              size={18}
              weight="fill"
            />
            {check}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function AuthForm({ mode }: { mode: AuthMode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const isSignUp = mode === "sign-up";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmissionError(undefined);
    const formData = new FormData(event.currentTarget);
    const input = Object.fromEntries(formData.entries());

    try {
      if (isSignUp) {
        const parsedInput = signUpSchema.safeParse(input);

        if (!parsedInput.success) {
          setFieldErrors(firstFieldErrors(parsedInput.error));
          return;
        }

        setFieldErrors({});
        setSubmitting(true);
        const result = await authClient.signUp.email({
          email: parsedInput.data.email,
          name: parsedInput.data.name,
          password: parsedInput.data.password,
        });

        if (result.error) {
          setSubmissionError("We could not create that account. Check the details and try again.");
          return;
        }

        navigate("/onboarding", { replace: true });
      } else {
        const parsedInput = signInSchema.safeParse(input);

        if (!parsedInput.success) {
          setFieldErrors(firstFieldErrors(parsedInput.error));
          return;
        }

        setFieldErrors({});
        setSubmitting(true);
        const result = await authClient.signIn.email({
          email: parsedInput.data.email,
          password: parsedInput.data.password,
        });

        if (result.error) {
          setSubmissionError("The email or password was not accepted.");
          return;
        }

        navigate(safeReturnPath(location.state), { replace: true });
      }
    } catch {
      setSubmissionError("The authentication service is unavailable. Try again shortly.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="ledger-surface grid min-h-[58svh] place-items-center bg-mp-canvas p-5 sm:p-8 lg:min-h-svh">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center justify-between gap-4 border-mp-border border-b pb-4">
          <p className="section-kicker">Secure dashboard access</p>
          <ShieldCheckIcon aria-hidden="true" className="text-mp-signal-strong" size={25} />
        </div>
        <h2 className="font-mp-display text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
          {isSignUp ? "Create your operator account" : "Return to the ledger"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-mp-ink-muted">
          {isSignUp
            ? "Start with an account, then create the organization that owns your metering data."
            : "Use the email and password tied to your MeterPilot workspace."}
        </p>

        {!isSignUp && sessionExpired(location.state) ? (
          <Notice className="mt-5" title="Session expired" tone="warning">
            <p>Sign in again to continue. Your requested page has been preserved.</p>
          </Notice>
        ) : null}

        {submissionError ? (
          <Notice className="mt-5" title="Authentication failed" tone="danger">
            <p>{submissionError}</p>
          </Notice>
        ) : null}

        <form className="mt-7 grid gap-5" noValidate onSubmit={(event) => void handleSubmit(event)}>
          {isSignUp ? (
            <TextField
              autoComplete="name"
              {...(fieldErrors.name ? { error: fieldErrors.name } : {})}
              label="Name"
              name="name"
              placeholder="Ada Lovelace"
              required
            />
          ) : null}
          <TextField
            autoCapitalize="none"
            autoComplete="email"
            {...(fieldErrors.email ? { error: fieldErrors.email } : {})}
            inputMode="email"
            label="Email"
            name="email"
            placeholder="you@company.com"
            required
            type="email"
          />
          <TextField
            autoComplete={isSignUp ? "new-password" : "current-password"}
            {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
            {...(isSignUp ? { hint: "Use 8–128 characters." } : {})}
            label="Password"
            maxLength={128}
            minLength={isSignUp ? 8 : 1}
            name="password"
            required
            type="password"
          />
          <Button
            loading={submitting}
            loadingLabel={isSignUp ? "Creating account…" : "Signing in…"}
            type="submit"
          >
            {isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-sm text-mp-ink-muted">
          {isSignUp ? "Already have an account?" : "New to MeterPilot?"}{" "}
          <Link
            className="font-semibold text-mp-ink underline decoration-mp-signal-strong decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mp-warning"
            to={isSignUp ? "/sign-in" : "/sign-up"}
          >
            {isSignUp ? "Sign in" : "Create one"}
          </Link>
        </p>
      </div>
    </main>
  );
}

function AuthPage({ mode }: { mode: AuthMode }) {
  return (
    <div className="auth-layout min-h-svh">
      <AuthStory />
      <AuthForm mode={mode} />
    </div>
  );
}

export function SignInPage() {
  return <AuthPage mode="sign-in" />;
}

export function SignUpPage() {
  return <AuthPage mode="sign-up" />;
}
