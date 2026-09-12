import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/jcs.ts";
import { answersHash, definitionHash, payloadHash, sha256Hex, toHex, utf8 } from "../src/hash.ts";
import { submissionHash, submissionHashPreimage, manifestEvidenceHashes } from "../src/submission.ts";
import { EngineError, JcsError } from "../src/errors.ts";
import { fixtures } from "./helpers.ts";

interface JcsCase {
  name: string;
  input_json?: string;
  ieee754_hex?: string;
  canonical?: string;
  sha256?: string;
  error?: string;
}

function fromHex(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < 8; i++) view.setUint8(i, parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return view.getFloat64(0);
}

describe("JCS fixture contract (schema/fixtures/jcs)", () => {
  for (const f of fixtures<{ cases: JcsCase[] }>("jcs")) {
    describe(f.name, () => {
      for (const c of f.data.cases) {
        it(c.name, async () => {
          const value: unknown = c.ieee754_hex !== undefined ? fromHex(c.ieee754_hex) : JSON.parse(c.input_json as string);
          if (c.error) {
            expect(() => canonicalize(value)).toThrowError(JcsError);
            try {
              canonicalize(value);
            } catch (e) {
              expect((e as JcsError).code).toBe(c.error);
            }
            return;
          }
          expect(canonicalize(value)).toBe(c.canonical);
          if (c.sha256) {
            expect(await sha256Hex(c.canonical as string)).toBe(c.sha256);
            expect(await payloadHash(value)).toBe(c.sha256);
          }
        });
      }
    });
  }
});

describe("canonicalize edge cases", () => {
  it("treats undefined-valued properties as absent", () => {
    expect(canonicalize({ b: 1, a: undefined })).toBe('{"b":1}');
  });
  it("rejects values JSON cannot carry", () => {
    for (const v of [undefined, () => 1, 10n, Symbol("x"), new Date(0), [undefined]]) {
      expect(() => canonicalize(v)).toThrowError(JcsError);
    }
  });
  it("rejects absurd nesting", () => {
    let v: unknown = 1;
    for (let i = 0; i < 1002; i++) v = [v];
    expect(() => canonicalize(v)).toThrow(/JCS_TOO_DEEP/);
  });
  it("accepts null-prototype objects", () => {
    const o = Object.create(null) as Record<string, number>;
    o["z"] = 1;
    o["a"] = 2;
    expect(canonicalize(o)).toBe('{"a":2,"z":1}');
  });
});

describe("hashing", () => {
  it("sha256 of bytes and strings agree", async () => {
    const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(await sha256Hex("")).toBe(empty);
    expect(await sha256Hex(new Uint8Array())).toBe(empty);
    expect(await sha256Hex(utf8("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });
  it("answers and definition hashes are JCS hashes", async () => {
    const v = { b: [1, 2], a: "x" };
    const expected = await sha256Hex('{"a":"x","b":[1,2]}');
    expect(await answersHash(v)).toBe(expected);
    expect(await definitionHash(v)).toBe(expected);
  });
});

interface ShCase {
  name: string;
  input: Parameters<typeof submissionHash>[0];
  preimage?: string;
  sha256?: string;
  error?: string;
}

describe("submission hash (schema/fixtures/submission_hash)", () => {
  for (const f of fixtures<{ cases: ShCase[] }>("submission_hash")) {
    for (const c of f.data.cases) {
      it(c.name, async () => {
        if (c.error) {
          expect(() => submissionHashPreimage(c.input)).toThrowError(EngineError);
          await expect(submissionHash(c.input)).rejects.toMatchObject({ code: c.error });
          return;
        }
        expect(submissionHashPreimage(c.input)).toBe(c.preimage);
        expect(await submissionHash(c.input)).toBe(c.sha256);
      });
    }
  }
  it("reads evidence hashes from a manifest", () => {
    expect(manifestEvidenceHashes({ evidence: [{ sha256: "a" }, { sha256: "b" }] })).toEqual(["a", "b"]);
  });
});
