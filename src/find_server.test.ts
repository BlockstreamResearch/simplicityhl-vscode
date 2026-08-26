import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire, Module } from "node:module";
import { beforeEach, test } from "node:test";
import type * as vscode from "vscode";

import { DailyUpdateCache, type UpdateCache } from "./update_cache";

const CACHE_KEY = "simfmt.lastUpdateAttemptAt";
const DAY_MS = 24 * 60 * 60 * 1000;
const disposable = { dispose() {} };
const document = {
  uri: { scheme: "file", fsPath: "/test/example.simf" },
  languageId: "simplicityhl",
  isDirty: false,
} as vscode.TextDocument;

function createHost() {
  const values = new Map<string, unknown>();
  const globalState: Pick<vscode.Memento, "get" | "update"> = {
    get<T>(key: string, defaultValue?: T): T {
      return values.has(key) ? values.get(key) as T : defaultValue;
    },
    async update(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  };

  return {
    values,
    globalState,
    settings: { "formatter.disableAutoupdate": false } as Record<string, unknown>,
    executables: new Set(["cargo", "simfmt", "simplicityhl-lsp"]),
    outcome: "success" as "success" | "failure" | "cancel",
    installs: [] as string[],
    notifications: [] as string[],
    errors: [] as unknown[],
    warnings: [] as string[],
    formatRuns: 0,
    cancellations: 0,
    command: undefined as (() => Promise<void>) | undefined,
    provider: undefined as vscode.DocumentFormattingEditProvider | undefined,
  };
}

let host = createHost();
beforeEach(() => { host = createHost(); });

const vscodeMock = {
  ProgressLocation: { Notification: 15 },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) => host.settings[key] ?? fallback,
    }),
  },
  commands: {
    registerCommand: (_name: string, callback: () => Promise<void>) => {
      host.command = callback;
      return disposable;
    },
  },
  languages: {
    registerDocumentFormattingEditProvider: (_selector: unknown, provider: vscode.DocumentFormattingEditProvider) => {
      host.provider = provider;
      return disposable;
    },
  },
  window: {
    activeTextEditor: { document },
    createOutputChannel: () => ({ ...disposable, clear() {}, append() {}, appendLine() {} }),
    showErrorMessage: async (error: unknown) => { host.errors.push(error); },
    showWarningMessage: async (message: string) => { host.warnings.push(message); },
    withProgress: async (
      options: { title: string },
      task: (progress: { report(): void }, token: { onCancellationRequested(callback: () => void): typeof disposable }) => Promise<void>,
    ) => {
      host.notifications.push(options.title);
      return task({ report() {} }, {
        onCancellationRequested(callback) {
          if (host.outcome === "cancel") queueMicrotask(callback);
          return disposable;
        },
      });
    },
  },
};

const processMock = {
  spawn: (_command: string, args: string[], options: { signal?: AbortSignal } = {}) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    options.signal?.addEventListener("abort", () => {
      host.cancellations += 1;
      queueMicrotask(() => {
        child.emit("error", new Error("The operation was aborted"));
        child.emit("close", null);
      });
    }, { once: true });
    if (args[0] === "install") {
      const command = args.at(-1);
      host.installs.push(command);
      if (host.outcome !== "cancel") {
        queueMicrotask(() => {
          const succeeded = host.outcome === "success";
          if (succeeded) host.executables.add(command);
          child.emit("close", succeeded ? 0 : 1);
        });
      }
    } else {
      host.formatRuns += 1;
      queueMicrotask(() => child.emit("close", 0));
    }
    return child;
  },
};

// VS Code exists only in the extension host. Replace host/process dependencies
// while loading these modules, then restore Node's loader before running tests.
const loadModule = createRequire(__filename);
const sourceFiles = new Set(["./format", "./lsp/install", "./document"].map((name) => loadModule.resolve(name)));
const mocks: Record<string, unknown> = {
  vscode: vscodeMock,
  child_process: processMock,
  "node:child_process": processMock,
  "../find_executable": {
    findExecutable: (command: string) => host.executables.has(command) ? `/test/bin/${command}` : null,
  },
};
const loader = Module as unknown as {
  _load(request: string, parent?: NodeJS.Module, isMain?: boolean): unknown;
};
const originalLoad = loader._load;
let formatterModule: typeof import("./format");
let serverModule: typeof import("./lsp/install");
try {
  loader._load = function (request, parent, isMain) {
    if (sourceFiles.has(parent?.filename) && Object.hasOwn(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  formatterModule = loadModule("./format");
  serverModule = loadModule("./lsp/install");
} finally {
  loader._load = originalLoad;
}

function context(): vscode.ExtensionContext {
  return { globalState: host.globalState, subscriptions: [] } as unknown as vscode.ExtensionContext;
}

async function formatDocument(): Promise<void> {
  const edits = await host.provider.provideDocumentFormattingEdits(
    document,
    { tabSize: 2, insertSpaces: true },
    { isCancellationRequested: false } as vscode.CancellationToken,
  );
  assert.deepEqual(edits, []);
}

void test("shares the daily cache between formatting entry points and across re-registration", async (t) => {
  let now = 1_750_000_000_000;
  t.mock.method(Date, "now", () => now);
  formatterModule.registerFormattingCommands(context());
  await formatDocument();
  await host.command();
  assert.equal(host.values.get(CACHE_KEY), now);

  // Re-registration creates a new formatter/cache, as on extension host reload.
  formatterModule.registerFormattingCommands(context());
  await formatDocument();
  assert.deepEqual(host.installs, ["simfmt"]);
  assert.deepEqual(host.notifications, ["Updating simfmt"]);
  assert.equal(host.formatRuns, 3);

  now += DAY_MS;
  await formatDocument();
  assert.deepEqual(host.installs, ["simfmt", "simfmt"]);
  assert.equal(host.values.get(CACHE_KEY), now);
});

void test("uses an injected cache for update decisions without creating persistent state", async (t) => {
  let allowUpdate = false;
  const cache: UpdateCache = { shouldUpdate: t.mock.fn(async () => allowUpdate) };
  formatterModule.registerFormattingCommands(context(), cache);
  await formatDocument();
  assert.deepEqual(host.installs, []);

  allowUpdate = true;
  await formatDocument();
  assert.deepEqual(host.installs, ["simfmt"]);
  assert.equal(host.values.size, 0);
});

void test("custom formatter paths bypass the cache and automatic updates", async (t) => {
  host.settings["formatter.path"] = "  /custom/simfmt  ";
  const shouldUpdate = t.mock.fn(async () => true);
  assert.equal(await formatterModule.getSimfmtPath({ shouldUpdate }), "/custom/simfmt");
  assert.equal(shouldUpdate.mock.callCount(), 0);
  assert.deepEqual(host.installs, []);
});

void test("disabled autoupdate bypasses the cache for an installed formatter", async (t) => {
  host.settings["formatter.disableAutoupdate"] = true;
  const shouldUpdate = t.mock.fn(async () => true);
  assert.equal(await formatterModule.getSimfmtPath({ shouldUpdate }), "/test/bin/simfmt");
  assert.equal(shouldUpdate.mock.callCount(), 0);
  assert.deepEqual(host.installs, []);
});

void test("missing Cargo bypasses the cache and preserves executable discovery", async (t) => {
  host.executables.delete("cargo");
  const shouldUpdate = t.mock.fn(async () => true);
  assert.equal(await formatterModule.getSimfmtPath({ shouldUpdate }), "/test/bin/simfmt");

  host.executables.delete("simfmt");
  await assert.rejects(formatterModule.getSimfmtPath({ shouldUpdate }), /simfmt formatter not found/);
  assert.equal(shouldUpdate.mock.callCount(), 0);
  assert.deepEqual(host.installs, []);
  assert.equal(host.warnings.length, 1);
});

void test("installs a missing formatter even when the cache declines an update", async (t) => {
  host.executables.delete("simfmt");
  const shouldUpdate = t.mock.fn(async () => false);
  assert.equal(await formatterModule.getSimfmtPath({ shouldUpdate }), "/test/bin/simfmt");
  assert.equal(shouldUpdate.mock.callCount(), 1);
  assert.deepEqual(host.notifications, ["Installing simfmt"]);
  assert.deepEqual(host.installs, ["simfmt"]);
});

void test("initial installation with autoupdate enabled reserves the daily cooldown", async () => {
  host.executables.delete("simfmt");
  formatterModule.registerFormattingCommands(context());
  await formatDocument();
  await formatDocument();
  assert.equal(typeof host.values.get(CACHE_KEY), "number");
  assert.deepEqual(host.notifications, ["Installing simfmt"]);
  assert.deepEqual(host.installs, ["simfmt"]);
});

void test("installs a missing formatter with autoupdate disabled without consulting the cache", async (t) => {
  host.executables.delete("simfmt");
  host.settings["formatter.disableAutoupdate"] = true;
  const shouldUpdate = t.mock.fn(async () => true);
  assert.equal(await formatterModule.getSimfmtPath({ shouldUpdate }), "/test/bin/simfmt");
  assert.equal(shouldUpdate.mock.callCount(), 0);
  assert.deepEqual(host.installs, ["simfmt"]);
});

for (const outcome of ["failure", "cancel"] as const) {
  void test(`keeps the daily cooldown after update ${outcome}`, async () => {
    let now = 1_750_000_000_000;
    host.outcome = outcome;
    const cache = new DailyUpdateCache(host.globalState, CACHE_KEY, () => now);
    await assert.rejects(formatterModule.getSimfmtPath(cache), /simfmt formatter not found/);
    assert.equal(host.errors.length, 1);
    assert.equal(host.cancellations, outcome === "cancel" ? 1 : 0);
    assert.equal(await formatterModule.getSimfmtPath(cache), "/test/bin/simfmt");

    const reloadedCache = new DailyUpdateCache(host.globalState, CACHE_KEY, () => now);
    assert.equal(await formatterModule.getSimfmtPath(reloadedCache), "/test/bin/simfmt");
    assert.deepEqual(host.installs, ["simfmt"]);

    now += DAY_MS;
    host.outcome = "success";
    assert.equal(await formatterModule.getSimfmtPath(reloadedCache), "/test/bin/simfmt");
    assert.deepEqual(host.installs, ["simfmt", "simfmt"]);
  });
}

void test("LSP callers without a cache retain their existing update behavior", async () => {
  await serverModule.ensureExecutable("simplicityhl-lsp");
  await serverModule.ensureExecutable("simplicityhl-lsp");
  assert.deepEqual(host.installs, ["simplicityhl-lsp", "simplicityhl-lsp"]);
  assert.equal(host.values.size, 0);

  host.settings.disableAutoupdate = true;
  assert.equal(await serverModule.ensureExecutable("simplicityhl-lsp"), "/test/bin/simplicityhl-lsp");
  assert.equal(host.installs.length, 2);
});
