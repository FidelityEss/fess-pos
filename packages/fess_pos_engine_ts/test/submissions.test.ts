import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parseDefinitionOfKind } from "../src/definitions/index.ts";
import type { FormDefinition } from "../src/definitions/index.ts";
import { validateSubmission } from "../src/validator.ts";
import type { AnswersDocument } from "../src/validator.ts";
import type { ResolveLists } from "../src/resolver.ts";
import { runTestCase, runTestCases } from "../src/testcases.ts";
import type { TestCase } from "../src/testcases.ts";
import { FIXTURES, errorKeys, fixtures, readJson, schemaFor } from "./helpers.ts";

function form(stem: string): FormDefinition {
  const res = parseDefinitionOfKind(readJson(join(FIXTURES, "definitions", "valid", `${stem}.json`)), "form");
  if (!res.ok) throw new Error(`${stem} does not parse: ${JSON.stringify(res.errors)}`);
  return res.definition;
}

interface SubmissionFixture {
  form: string;
  lists?: ResolveLists;
  document: AnswersDocument;
  expected: { ok: boolean; errors: { field_key: string; code: string }[] };
}

const answersDocument = schemaFor("api/answers-document.schema.json");

for (const dir of ["valid", "invalid"] as const) {
  describe(`submissions/${dir}`, () => {
    for (const f of fixtures<SubmissionFixture>(`submissions/${dir}`)) {
      it(f.name, async () => {
        const res = await validateSubmission(form(f.data.form), f.data.document, { lists: f.data.lists ?? {} });
        expect(errorKeys(res.errors)).toEqual(errorKeys(f.data.expected.errors));
        expect(res.ok).toBe(f.data.expected.ok);
        if (dir === "valid" && f.data.document.answers_hash !== undefined) {
          expect(answersDocument(f.data.document), JSON.stringify(answersDocument.errors)).toBe(true);
        }
      });
    }
  });
}

interface TestcaseFixture {
  form: string;
  lists?: ResolveLists;
  cases: (TestCase & { expect_pass?: boolean })[];
}

describe("definition test cases (schema/fixtures/testcases)", () => {
  for (const f of fixtures<TestcaseFixture>("testcases")) {
    describe(f.name, () => {
      const def = form(f.data.form);
      for (const c of f.data.cases) {
        it(c.name, () => {
          const res = runTestCase(def, { ...c, lists: f.data.lists ?? c.lists ?? {} });
          expect(res.passed, JSON.stringify(res.failures)).toBe(c.expect_pass ?? true);
          if (c.expect_pass === false) expect(res.failures.length).toBeGreaterThan(0);
        });
      }
      it("runTestCases aggregates", () => {
        const all = runTestCases(def, f.data.cases.filter((c) => c.expect_pass !== false).map((c) => ({ ...c, lists: f.data.lists ?? {} })));
        expect(all.passed).toBe(true);
      });
    });
  }
});
