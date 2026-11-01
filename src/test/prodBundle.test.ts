import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";

/**
 * D4 evidence: the production bundle must not contain developer tooling.
 * Requires the production build; absence is a real failed verification, never skipped.
 */
const distDir = path.resolve(__dirname, "../../dist/assets");
describe("production bundle", () => {
  const bundle = existsSync(distDir) ? readdirSync(distDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(path.join(distDir, f), "utf8"))
    .join("\n") : null;

  it("has actual compiled production assets", () => expect(bundle?.length).toBeGreaterThan(0));

  it.each([
    "DJDevTools",
    "IngestTestPanel",
    "BridgeMonitor",
    "smoke_test",
    "test_ingest",
    "Bridge & ingest debug",
    "now-playing-ingest",
  ])("contains no developer tooling reference: %s", (needle) => {
    expect(bundle).not.toBeNull();
    expect(bundle?.includes(needle)).toBe(false);
  });

  it("contains no /dj/:id/dev route path", () => {
    expect(bundle).not.toBeNull();
    expect(bundle?.includes("/dj/:id/dev")).toBe(false);
  });
});

describe("development build", () => {
  it("keeps the developer route module available in source", () => {
    expect(existsSync(path.resolve(__dirname, "../dev/DJDevTools.tsx"))).toBe(true);
    expect(existsSync(path.resolve(__dirname, "../dev/DevRoutes.tsx"))).toBe(true);
  });

  it("registers the dev route only behind import.meta.env.DEV", () => {
    const app = readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
    expect(app).toContain('import.meta.env.DEV ? lazy(() => import("./dev/DevRoutes")) : null');
    expect(app).not.toMatch(/^import DJDevTools/m);
  });
});
