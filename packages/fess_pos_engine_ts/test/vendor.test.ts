import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./helpers.ts";

const script = join(REPO, "tools", "vendor-engine.mjs");
const run = (dest: string) => spawnSync(process.execPath, [script, dest], { encoding: "utf8" });

describe("tools/vendor-engine.mjs", () => {
  it("copies src with GENERATED headers and rewrites the zod import for Deno", () => {
    const dest = join(mkdtempSync(join(tmpdir(), "fess-vendor-")), "engine");
    const first = run(dest);
    expect(first.status, first.stderr).toBe(0);
    const index = readFileSync(join(dest, "index.ts"), "utf8");
    expect(index.startsWith("// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/index.ts")).toBe(true);
    const schemas = readFileSync(join(dest, "definitions", "schemas.ts"), "utf8");
    expect(schemas).toContain('from "npm:zod@^3.25.76"');
    expect(schemas).not.toMatch(/from "zod"/);
    expect(readdirSync(join(dest, "rules")).sort()).toContain("evaluate.ts");
    expect(run(dest).status).toBe(0);
    writeFileSync(join(dest, "hand-written.ts"), "export const x = 1;\n");
    const refused = run(dest);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("refusing to overwrite");
  });
});
