import * as assert from "node:assert/strict";
import { test } from "node:test";

import { compilerFeatureArguments } from "./features";

void test("does not enable experimental compiler features by default", () => {
  assert.deepEqual(
    compilerFeatureArguments({ imports: false, enums: false }),
    [],
  );
});

void test("maps each experimental setting to its simc flag", () => {
  assert.deepEqual(
    compilerFeatureArguments({ imports: true, enums: false }),
    ["-Z", "imports"],
  );
  assert.deepEqual(
    compilerFeatureArguments({ imports: false, enums: true }),
    ["-Z", "enums"],
  );
  assert.deepEqual(
    compilerFeatureArguments({ imports: true, enums: true }),
    ["-Z", "imports", "-Z", "enums"],
  );
});
