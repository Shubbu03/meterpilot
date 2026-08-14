import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../src/button";

describe("Button", () => {
  test("defaults to a safe non-submit button", () => {
    const markup = renderToStaticMarkup(<Button>Save changes</Button>);

    expect(markup).toContain('type="button"');
    expect(markup).toContain('data-variant="primary"');
    expect(markup).toContain("bg-mp-signal");
    expect(markup).toContain("Save changes");
  });

  test("exposes its loading state and prevents duplicate actions", () => {
    const markup = renderToStaticMarkup(
      <Button loading loadingLabel="Saving price version">
        Save
      </Button>,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Saving price version");
    expect(markup).not.toContain(">Save<");
  });
});
