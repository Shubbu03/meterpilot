import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TextField } from "../src/text-field";

describe("TextField", () => {
  test("connects its label and hint to the input", () => {
    const markup = renderToStaticMarkup(
      <TextField hint="Use the public identifier" id="meter-id" label="Meter ID" />,
    );

    expect(markup).toContain('for="meter-id"');
    expect(markup).toContain('id="meter-id"');
    expect(markup).toContain('aria-describedby="meter-id-hint"');
  });

  test("announces validation errors and preserves caller descriptions", () => {
    const markup = renderToStaticMarkup(
      <TextField
        aria-describedby="external-help"
        error="Enter the project name to confirm"
        id="confirmation"
        label="Confirmation"
        required
      />,
    );

    expect(markup).toContain('aria-describedby="external-help confirmation-error"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Required");
  });
});
