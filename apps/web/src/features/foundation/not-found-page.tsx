import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="page-frame">
      <p className="section-kicker">404 / Unknown route</p>
      <h1 className="mt-4 font-mp-display text-5xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-4 text-sm text-mp-ink-muted">The requested workspace does not exist.</p>
      <Link
        className="mt-6 inline-flex min-h-11 items-center font-semibold text-sm underline decoration-mp-signal-strong decoration-2 underline-offset-4"
        to="/"
      >
        Return to overview
      </Link>
    </div>
  );
}
