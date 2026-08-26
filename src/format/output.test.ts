import * as assert from "node:assert/strict";
import { test } from "node:test";

import { getFailureNotification, parseFormatterDiagnostics } from "./output";

void test("parses multiple formatter diagnostics with Windows and Unix file paths", () => {
  const output = [
    "error[E001]: incorrect type",
    "  --> C:\\contracts\\main.simf:12:5",
    "",
    "error: missing expression",
    "  --> /contracts/other.simf:3:9",
    "",
    "error: compilation failed",
  ].join("\r\n");

  assert.deepEqual(parseFormatterDiagnostics(output), [
    { message: "incorrect type", filePath: "C:\\contracts\\main.simf", line: 12, column: 5 },
    { message: "missing expression", filePath: "/contracts/other.simf", line: 3, column: 9 },
  ]);
});

void test("directs located formatter diagnostics to the output channel", () => {
  assert.equal(
    getFailureNotification("error: incorrect type\n  --> /contracts/main.simf:12:5\n"),
    "Formatting failed. See the SimplicityHL Formatter output for details.",
  );
});

void test("uses the first output line or an empty-output fallback when diagnostics have no location", () => {
  assert.deepEqual(parseFormatterDiagnostics("error: unable to read file"), []);
  assert.equal(
    getFailureNotification("error: unable to read file\nmore details"),
    'Formatting failed: "error: unable to read file".',
  );
  assert.equal(
    getFailureNotification("\n"),
    'Formatting failed: "simfmt failed without reporting an error".',
  );
});
