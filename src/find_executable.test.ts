import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { findExecutable } from "./find_executable";

void test("Windows fallback finds a regular Cargo-bin executable outside PATH", async () => {
  const profile = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "simplicityhl-windows-profile-"),
  );
  try {
    const cargoBin = path.join(profile, ".cargo", "bin");
    await fs.promises.mkdir(cargoBin, { recursive: true });
    const executable = path.join(cargoBin, "simplicityhl-lsp.exe");
    await fs.promises.writeFile(executable, "test executable");
    await fs.promises.mkdir(path.join(cargoBin, "cargo.exe"));
    await fs.promises.writeFile(path.join(cargoBin, "cargo.cmd"), "echo cargo");

    const options = {
      environment: { USERPROFILE: profile, PATHEXT: ".EXE;.CMD", PATH: "" },
      homeDirectory: profile,
      platform: "win32" as const,
    };
    assert.equal(findExecutable("simplicityhl-lsp", options), executable);
    assert.equal(findExecutable("cargo", options), null);
  } finally {
    await fs.promises.rm(profile, { recursive: true, force: true });
  }
});

void test("PATH results are validated and returned as one absolute path", async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "simplicityhl-relative-locator-"),
  );
  try {
    const executable = path.join(directory, "simc");
    await fs.promises.writeFile(executable, "#!/bin/sh\n");
    await fs.promises.chmod(executable, 0o755);
    const relative = path.relative(process.cwd(), executable);

    assert.equal(findExecutable("simc", {
      environment: { PATH: path.dirname(relative) },
      platform: process.platform,
    }), executable);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

void test("Windows locator ignores command scripts that direct spawning cannot run", async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "simplicityhl-windows-locator-"),
  );
  try {
    const commandScript = path.join(directory, "cargo.cmd");
    const executable = path.join(directory, "cargo.exe");
    await Promise.all([
      fs.promises.writeFile(commandScript, "echo cargo"),
      fs.promises.writeFile(executable, "executable"),
    ]);
    const options = {
      environment: {
        USERPROFILE: path.join(directory, "empty-profile"),
        PATHEXT: ".EXE;.CMD",
        PATH: directory,
      },
      homeDirectory: directory,
      platform: "win32" as const,
    };

    assert.equal(findExecutable("cargo", options), executable);
    await fs.promises.rm(executable);
    assert.equal(findExecutable("cargo", options), null);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
