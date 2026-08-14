import { describe, expect, test } from "bun:test";

const globalsUrl = new URL("../src/globals.css", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

describe("Tailwind global stylesheet", () => {
  test("uses the canonical Tailwind v4 entrypoint and source registration", async () => {
    const globals = Bun.file(globalsUrl);

    expect(await globals.exists()).toBeTrue();

    const css = await globals.text();

    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain('@source "./";');
    expect(css).toContain("@theme inline");
    expect(css).not.toContain("source none");
    expect(css).not.toContain("source(none)");
  });

  test("exports and builds the global stylesheet by its public name", async () => {
    const manifest = (await Bun.file(packageUrl).json()) as {
      exports: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(manifest.exports["./globals.css"]).toBe("./src/globals.css");
    expect(manifest.exports["./styles.css"]).toBeUndefined();
    expect(manifest.scripts["build:styles"]).toContain("src/globals.css");
    expect(manifest.scripts["build:styles"]).toContain("dist/globals.css");
  });
});
