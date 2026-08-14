import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "../src/empty-state";
import { FreshnessStamp } from "../src/freshness-stamp";
import { Notice } from "../src/notice";
import { Panel, PanelHeader, PanelTitle } from "../src/panel";
import { StatusBadge } from "../src/status-badge";

describe("status and content primitives", () => {
  test("renders status text in addition to its visual marker", () => {
    const markup = renderToStaticMarkup(<StatusBadge tone="warning">Replaying</StatusBadge>);

    expect(markup).toContain('data-tone="warning"');
    expect(markup).toContain("Replaying");
  });

  test("uses an alert role for danger notices", () => {
    const markup = renderToStaticMarkup(
      <Notice title="Import failed" tone="danger">
        Request req_123 could not be processed.
      </Notice>,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("req_123");
  });

  test("renders semantic panel and empty-state headings", () => {
    const panel = renderToStaticMarkup(
      <Panel>
        <PanelHeader>
          <PanelTitle as="h3">Active price version</PanelTitle>
        </PanelHeader>
      </Panel>,
    );
    const empty = renderToStaticMarkup(
      <EmptyState description="Ingest an event to begin." title="No usage recorded" />,
    );

    expect(panel).toContain("<section");
    expect(panel).toContain("<h3");
    expect(empty).toContain('aria-labelledby="');
    expect(empty).toContain("No usage recorded");
  });

  test("uses a machine-readable time for freshness", () => {
    const markup = renderToStaticMarkup(
      <FreshnessStamp dateTime="2026-08-13T10:30:00.000Z">2 minutes ago</FreshnessStamp>,
    );

    expect(markup).toContain('dateTime="2026-08-13T10:30:00.000Z"');
    expect(markup).toContain("2 minutes ago");
  });
});
