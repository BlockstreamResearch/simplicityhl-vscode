import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire, Module } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import type * as vscode from "vscode";

import { DailyUpdateCache, type UpdateCache } from "./update_cache";
import { COMMAND_IDS } from "./contracts";

const CACHE_KEY = "simfmt.lastUpdateAttemptAt";
const DAY_MS = 24 * 60 * 60 * 1000;
const disposable = { dispose() {} };
const document = {
  uri: { scheme: "file", fsPath: "/test/example.simf" },
  languageId: "simplicityhl",
  isDirty: false,
} as vscode.TextDocument;

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(): boolean;
}

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
    formatArgs: [] as string[],
    formatOutcome: "success" as "success" | "failure" | "pending",
    onFormatSpawn: undefined as ((child: MockChild) => void) | undefined,
    cancellations: 0,
    kills: 0,
    outputChannelsCreated: 0,
    outputChannelsDisposed: 0,
    output: [] as string[],
    contexts: [] as vscode.ExtensionContext[],
    command: undefined as (() => Promise<void>) | undefined,
    provider: undefined as vscode.DocumentFormattingEditProvider | undefined,
  };
}

let host = createHost();
beforeEach(() => { host = createHost(); });
afterEach(async () => {
  await extensionModule.deactivate();
  for (const context of host.contexts) {
    for (const subscription of context.subscriptions) subscription.dispose();
  }
});

const vscodeMock = {
  ProgressLocation: { Notification: 15 },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) => host.settings[key] ?? fallback,
    }),
  },
  commands: {
    registerCommand: (name: string, callback: () => Promise<void>) => {
      if (name === COMMAND_IDS.formatFile) host.command = callback;
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
    createOutputChannel: () => {
      host.outputChannelsCreated += 1;
      let disposed = false;
      const append = (text: string) => {
        assert.equal(disposed, false, "Cannot write to a disposed output channel");
        host.output.push(text);
      };
      return {
        clear() {
          assert.equal(disposed, false, "Cannot clear a disposed output channel");
          host.output = [];
        },
        append,
        appendLine: append,
        dispose() {
          assert.equal(disposed, false, "Output channel must only be disposed once");
          disposed = true;
          host.outputChannelsDisposed += 1;
        },
      };
    },
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
  spawn: (_command: string, args: string[], options: { signal?: AbortSignal; shell?: boolean } = {}) => {
    assert.equal(options.shell, false);
    const child: MockChild = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      exitCode: null,
      signalCode: null,
      kill: () => {
        host.kills += 1;
        queueMicrotask(() => close(null, "SIGTERM"));
        return true;
      },
    });
    const close = (code: number | null, signal: NodeJS.Signals | null = null) => {
      child.exitCode = code;
      child.signalCode = signal;
      child.emit("close", code, signal);
    };
    options.signal?.addEventListener("abort", () => {
      host.cancellations += 1;
      queueMicrotask(() => {
        child.emit("error", new Error("The operation was aborted"));
        close(null);
      });
    }, { once: true });
    if (args[0] === "install") {
      const command = args.at(-1);
      host.installs.push(command);
      if (host.outcome !== "cancel") {
        queueMicrotask(() => {
          const succeeded = host.outcome === "success";
          if (succeeded) host.executables.add(command);
          close(succeeded ? 0 : 1);
        });
      }
    } else {
      host.formatRuns += 1;
      host.formatArgs = args;
      host.onFormatSpawn?.(child);
      if (host.formatOutcome !== "pending") {
        queueMicrotask(() => {
          if (host.formatOutcome === "failure") {
            child.stderr.emit("data", Buffer.from("error: invalid expression\n  --> /test/example.simf:2:3\n"));
          }
          close(host.formatOutcome === "success" ? 0 : 1);
        });
      }
    }
    return child;
  },
};

// VS Code exists only in the extension host. Replace host/process dependencies
// while loading these modules, then restore Node's loader before running tests.
const loadModule = createRequire(__filename);
const sourceFiles = new Set([
  "./format", "./format/install", "./commands/format", "./install_executable",
  "./lsp/install", "./document", "./extension",
].map((name) => loadModule.resolve(name)));
const mocks: Record<string, unknown> = {
  vscode: vscodeMock,
  "node:child_process": processMock,
  "./find_executable": {
    findExecutable: (command: string) => host.executables.has(command) ? `/test/bin/${command}` : null,
  },
  "./lsp/client": {
    LspClient: class {
      async start() {}
      async restart() {}
      async shutdown() {}
    },
  },
  "./compiler": { SimplicityHLCompiler: class {} },
  "./commands/compile": { registerCompileCommands() {} },
  "./tasks/provider": { registerTaskProvider() {} },
};
const loader = Module as unknown as {
  _load(request: string, parent?: NodeJS.Module, isMain?: boolean): unknown;
};
const originalLoad = loader._load;
let formatterModule: typeof import("./format");
let formatterInstall: typeof import("./format/install");
let commandsModule: typeof import("./commands/format");
let extensionModule: typeof import("./extension");
let serverModule: typeof import("./lsp/install");
try {
  loader._load = function (request, parent, isMain) {
    if (sourceFiles.has(parent?.filename) && Object.hasOwn(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  formatterModule = loadModule("./format");
  formatterInstall = loadModule("./format/install");
  commandsModule = loadModule("./commands/format");
  extensionModule = loadModule("./extension");
  serverModule = loadModule("./lsp/install");
} finally {
  loader._load = originalLoad;
}

function context(): vscode.ExtensionContext {
  const context = { globalState: host.globalState, subscriptions: [] } as unknown as vscode.ExtensionContext;
  host.contexts.push(context);
  return context;
}

async function formatDocument(): Promise<void> {
  const edits = await host.provider.provideDocumentFormattingEdits(
    document,
    { tabSize: 2, insertSpaces: true },
    { isCancellationRequested: false } as vscode.CancellationToken,
  );
  assert.deepEqual(edits, []);
}

void test("lazily shares the formatter between entry points and persists its cache across activation", async (t) => {
  let now = 1_750_000_000_000;
  t.mock.method(Date, "now", () => now);
  extensionModule.activate(context());
  assert.equal(host.outputChannelsCreated, 0);
  assert.equal(await host.provider.provideDocumentFormattingEdits(
    document,
    { tabSize: 2, insertSpaces: true },
    { isCancellationRequested: true } as vscode.CancellationToken,
  ), undefined);
  assert.equal(host.outputChannelsCreated, 0);
  await formatDocument();
  await host.command();
  assert.equal(host.outputChannelsCreated, 1);
  assert.deepEqual(host.formatArgs, [document.uri.fsPath, "--color", "never"]);
  assert.equal(host.values.get(CACHE_KEY), now);

  await extensionModule.deactivate();
  assert.equal(host.outputChannelsDisposed, 1);
  extensionModule.activate(context());
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
  const formatter = new formatterModule.SimplicityHLFormatter(cache);
  const extensionContext = context();
  extensionContext.subscriptions.push(formatter);
  commandsModule.registerFormattingCommands(extensionContext, () => formatter);
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
  assert.equal(await formatterInstall.getSimfmtPath({ shouldUpdate }), "/custom/simfmt");
  assert.equal(shouldUpdate.mock.callCount(), 0);
  assert.deepEqual(host.installs, []);
});

void test("disabled autoupdate bypasses the cache for an installed formatter", async (t) => {
  host.settings["formatter.disableAutoupdate"] = true;
  const shouldUpdate = t.mock.fn(async () => true);
  assert.equal(await formatterInstall.getSimfmtPath({ shouldUpdate }), "/test/bin/simfmt");
  assert.equal(shouldUpdate.mock.callCount(), 0);
  assert.deepEqual(host.installs, []);
});

void test("formatter installation uses its own disabled-autoupdate default", async (t) => {
  delete host.settings["formatter.disableAutoupdate"];
  const shouldUpdate = t.mock.fn(async () => true);
  assert.equal(await formatterInstall.getSimfmtPath({ shouldUpdate }), "/test/bin/simfmt");
  assert.equal(shouldUpdate.mock.callCount(), 0);
  assert.deepEqual(host.installs, []);
});

void test("missing Cargo bypasses the cache and preserves executable discovery", async (t) => {
  host.executables.delete("cargo");
  const shouldUpdate = t.mock.fn(async () => true);
  assert.equal(await formatterInstall.getSimfmtPath({ shouldUpdate }), "/test/bin/simfmt");

  host.executables.delete("simfmt");
  await assert.rejects(formatterInstall.getSimfmtPath({ shouldUpdate }), /simfmt formatter not found/);
  assert.equal(shouldUpdate.mock.callCount(), 0);
  assert.deepEqual(host.installs, []);
  assert.equal(host.warnings.length, 1);
});

void test("installs a missing formatter even when the cache declines an update", async (t) => {
  host.executables.delete("simfmt");
  const shouldUpdate = t.mock.fn(async () => false);
  assert.equal(await formatterInstall.getSimfmtPath({ shouldUpdate }), "/test/bin/simfmt");
  assert.equal(shouldUpdate.mock.callCount(), 1);
  assert.deepEqual(host.notifications, ["Installing simfmt"]);
  assert.deepEqual(host.installs, ["simfmt"]);
});

void test("initial installation with autoupdate enabled reserves the daily cooldown", async () => {
  host.executables.delete("simfmt");
  extensionModule.activate(context());
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
  assert.equal(await formatterInstall.getSimfmtPath({ shouldUpdate }), "/test/bin/simfmt");
  assert.equal(shouldUpdate.mock.callCount(), 0);
  assert.deepEqual(host.installs, ["simfmt"]);
});

for (const outcome of ["failure", "cancel"] as const) {
  void test(`keeps the daily cooldown after update ${outcome}`, async () => {
    let now = 1_750_000_000_000;
    host.outcome = outcome;
    const cache = new DailyUpdateCache(host.globalState, CACHE_KEY, () => now);
    await assert.rejects(formatterInstall.getSimfmtPath(cache), /simfmt formatter not found/);
    assert.equal(host.errors.length, 1);
    assert.equal(host.cancellations, outcome === "cancel" ? 1 : 0);
    assert.equal(await formatterInstall.getSimfmtPath(cache), "/test/bin/simfmt");

    const reloadedCache = new DailyUpdateCache(host.globalState, CACHE_KEY, () => now);
    assert.equal(await formatterInstall.getSimfmtPath(reloadedCache), "/test/bin/simfmt");
    assert.deepEqual(host.installs, ["simfmt"]);

    now += DAY_MS;
    host.outcome = "success";
    assert.equal(await formatterInstall.getSimfmtPath(reloadedCache), "/test/bin/simfmt");
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

void test("formatter failures retain their output and diagnostic notification", async () => {
  host.formatOutcome = "failure";
  extensionModule.activate(context());
  const result = await host.provider.provideDocumentFormattingEdits(
    document,
    { tabSize: 2, insertSpaces: true },
    { isCancellationRequested: false } as vscode.CancellationToken,
  );
  assert.equal(result, undefined);
  assert.deepEqual(host.errors, ["Formatting failed. See the SimplicityHL Formatter output for details."]);
  assert.ok(host.output.join("\n").includes("invalid expression"));
});

void test("formatter disposal stops active children and prevents further formatting", async () => {
  host.formatOutcome = "pending";
  const formatter = new formatterModule.SimplicityHLFormatter({ shouldUpdate: async () => false });
  context().subscriptions.push(formatter);
  const started = new Promise<MockChild>((resolve) => { host.onFormatSpawn = resolve; });
  const formatting = formatter.formatDocument(document);
  const child = await started;

  formatter.dispose();
  formatter.dispose();
  const result = await formatting;
  child.stdout.emit("data", Buffer.from("late output"));
  assert.equal(result.success, false);
  assert.match(result.output, /extension shutdown/);
  assert.equal(child.signalCode, "SIGTERM");
  assert.equal(host.kills, 1);
  assert.equal(host.outputChannelsDisposed, 1);
  assert.deepEqual(host.errors, []);

  assert.equal((await formatter.formatDocument(document)).success, false);
  assert.equal(host.formatRuns, 1);
});

void test("formatter disposal during executable preparation prevents a later process launch", async () => {
  let finishDecision: (allowed: boolean) => void;
  const decision = new Promise<boolean>((resolve) => { finishDecision = resolve; });
  let markStarted: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const formatter = new formatterModule.SimplicityHLFormatter({
    shouldUpdate: async () => {
      markStarted();
      return decision;
    },
  });
  context().subscriptions.push(formatter);
  const formatting = formatter.formatDocument(document);
  await started;
  formatter.dispose();
  finishDecision(false);

  const result = await formatting;
  assert.equal(result.success, false);
  assert.match(result.output, /extension shutdown/);
  assert.equal(host.formatRuns, 0);
  assert.deepEqual(host.errors, []);
});

void test("formatter preserves autosave settings for dirty documents", async (t) => {
  const formatter = new formatterModule.SimplicityHLFormatter({ shouldUpdate: async () => false });
  context().subscriptions.push(formatter);
  const save = t.mock.fn(async () => true);
  const dirtyDocument = { ...document, isDirty: true, save } as vscode.TextDocument;

  host.settings["formatter.autoSaveBeforeFormat"] = false;
  assert.equal((await formatter.formatDocument(dirtyDocument)).success, false);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(host.formatRuns, 0);

  host.settings["formatter.autoSaveBeforeFormat"] = true;
  assert.equal((await formatter.formatDocument(dirtyDocument)).success, true);
  assert.equal(save.mock.callCount(), 1);
  assert.equal(host.formatRuns, 1);
});
