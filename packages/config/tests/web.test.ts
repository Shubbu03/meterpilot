import { describe, expect, test } from "bun:test";

import { parseWebConfig } from "../src/web";

describe("web configuration", () => {
  test("uses the local API by default", () => {
    expect(parseWebConfig({})).toEqual({ apiBaseUrl: "http://localhost:3000" });
  });

  test("returns browser-safe values only", () => {
    expect(
      parseWebConfig({
        DATABASE_URL: "postgresql://secret@localhost/meterpilot",
        VITE_API_BASE_URL: "https://api.example.com",
      }),
    ).toEqual({ apiBaseUrl: "https://api.example.com" });
  });

  test("rejects a relative API URL", () => {
    expect(() => parseWebConfig({ VITE_API_BASE_URL: "/api" })).toThrow(
      "Invalid web configuration",
    );
  });
});
