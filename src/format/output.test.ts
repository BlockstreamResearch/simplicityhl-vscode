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

void test("summarizes the first located formatter diagnostic", () => {
  assert.equal(
    getFailureNotification("simfmt starting\nerror: incorrect type\n  --> /contracts/main.simf:12:5\n"),
    "Formatting failed: incorrect type",
  );
});

void test("uses the first output line or an empty-output fallback when diagnostics have no location", () => {
  assert.deepEqual(parseFormatterDiagnostics("error: unable to read file"), []);
  assert.equal(
    getFailureNotification("error: unable to read file\nmore details"),
    "Formatting failed: error: unable to read file",
  );
  assert.equal(
    getFailureNotification("\n"),
    "Formatting failed: simfmt failed without reporting an error",
  );
});

void test("limits unexpected-error notifications only when they exceed 200 characters", () => {
  const prefix = "Formatting failed: ";
  for (const length of [199, 200]) {
    const message = "x".repeat(length - prefix.length);
    assert.equal(getFailureNotification(message), prefix + message);
  }

  const message = "x".repeat(1000);
  const expected = prefix + "x".repeat(199 - prefix.length) + "…";
  assert.equal(getFailureNotification(message), expected);
  assert.equal(getFailureNotification(`error: ${message}\n  --> /test/main.simf:1:1\n`), expected);
});
