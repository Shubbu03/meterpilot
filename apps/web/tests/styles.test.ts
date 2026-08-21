import { describe, expect, test } from "bun:test";

import stylesheet from "../src/styles/index.css" with { type: "text" };

describe("web stylesheet", () => {
  test("consumes the shared Tailwind v4 theme without redefining it", () => {
    expect(stylesheet).toContain('@import "@meterpilot/ui/globals.css"');
    expect(stylesheet).toContain('@source "../"');
    expect(stylesheet).not.toContain("@theme");
  });
});
