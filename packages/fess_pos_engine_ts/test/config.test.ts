import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  REMOTE_CONFIG_DEFAULTS,
  REMOTE_CONFIG_KEYS,
  RemoteConfigLayerSchema,
  applyHostOverrides,
  clientSafeView,
  integrityRelevantChanges,
  resolveRemoteConfig,
} from "../src/config/remote-config.ts";
import type { JsonObject, JsonValue } from "../src/json.ts";
import { readPath } from "../src/json.ts";
import { SCHEMA_DIR, expectJson, fixtures, readJson, schemaFor } from "./helpers.ts";

const configSchema = schemaFor("config/remote-config.schema.json");

interface Leaf {
  path: string;
  node: Record<string, unknown>;
}
function leaves(node: Record<string, unknown>, prefix = ""): Leaf[] {
  if ("x-integrity-relevant" in node) return [{ path: prefix, node }];
  const props = (node["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  return Object.entries(props).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("remote config contract (schema/config)", () => {
  const schema = readJson<Record<string, unknown>>(join(SCHEMA_DIR, "config", "remote-config.schema.json"));
  const found = leaves(schema);
  it("the JSON Schema and the TS key table list the same keys with the same flags, defaults and bounds", () => {
    expect(found.map((l) => l.path).sort()).toEqual(REMOTE_CONFIG_KEYS.map((k) => k.path).sort());
    for (const k of REMOTE_CONFIG_KEYS) {
      const leaf = found.find((l) => l.path === k.path)?.node ?? {};
      expect([leaf["x-integrity-relevant"], leaf["x-host-overridable"], leaf["x-client-safe"]], k.path).toEqual([k.integrityRelevant, k.hostOverridable, k.clientSafe]);
      expectJson(leaf["default"], k.default);
      if (k.type === "integer" || k.type === "number") expect([leaf["minimum"], leaf["maximum"]], k.path).toEqual([k.min, k.max]);
    }
  });
  it("defaults.json is the default document and is valid", () => {
    const defaults = readJson<JsonObject>(join(SCHEMA_DIR, "config", "defaults.json"));
    expectJson(defaults, REMOTE_CONFIG_DEFAULTS);
    expect(configSchema(defaults), JSON.stringify(configSchema.errors)).toBe(true);
    expect(RemoteConfigLayerSchema.safeParse(defaults).success).toBe(true);
  });
  it("geofence radius is bounded 25–500 m and every key is client-safe", () => {
    expect(REMOTE_CONFIG_KEYS.every((k) => k.clientSafe)).toBe(true);
    const profile = (schema["$defs"] as Record<string, { properties: Record<string, { minimum: number; maximum: number }> }>)["geofence_profile"];
    expect([profile?.properties["radius_m"]?.minimum, profile?.properties["radius_m"]?.maximum]).toEqual([25, 500]);
  });
});

describe("config layers (schema/fixtures/config)", () => {
  for (const f of fixtures<{ layers: unknown[]; expect_values?: Record<string, JsonValue> }>("config/valid")) {
    it(f.name, () => {
      for (const l of f.data.layers) expect(configSchema(l), JSON.stringify(configSchema.errors)).toBe(true);
      const res = resolveRemoteConfig(f.data.layers);
      expect(res.errors).toEqual([]);
      for (const [path, v] of Object.entries(f.data.expect_values ?? {})) expectJson(readPath(res.values, path) ?? null, v);
      expect(configSchema(res.values)).toBe(true);
    });
  }
  for (const f of fixtures<{ layers: unknown[]; schema_valid: boolean }>("config/invalid")) {
    it(f.name, () => {
      expect(f.data.layers.every((l) => configSchema(l))).toBe(f.data.schema_valid);
      const res = resolveRemoteConfig(f.data.layers);
      expect(res.ok).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    });
  }
});

describe("config helpers", () => {
  it("integrityRelevantChanges lists only integrity-relevant paths that changed", () => {
    const after = resolveRemoteConfig([{ geofence: { sample_seconds: 90 }, sync: { foreground_interval_s: 30 } }]).values;
    expect(integrityRelevantChanges(REMOTE_CONFIG_DEFAULTS, after)).toEqual(["geofence.sample_seconds"]);
  });
  it("applyHostOverrides honours host_overridable keys only", () => {
    const res = applyHostOverrides(REMOTE_CONFIG_DEFAULTS, { "theme.primary_color": "#112233", "geofence.sample_seconds": 10, "theme.font_family": 5 });
    expect(readPath(res.values, "theme.primary_color")).toBe("#112233");
    expect(readPath(res.values, "geofence.sample_seconds")).toBe(60);
    expect(res.rejected.sort()).toEqual(["geofence.sample_seconds", "theme.font_family"]);
  });
  it("clientSafeView keeps client-safe keys", () => {
    expectJson(clientSafeView(REMOTE_CONFIG_DEFAULTS), REMOTE_CONFIG_DEFAULTS);
  });
});
