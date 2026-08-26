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
    errorActions: [] as string[][],
    errorSelection: undefined as string | Promise<string | undefined> | undefined,
    warnings: [] as string[],
    formatRuns: 0,
    formatArgs: [] as string[],
    formatOutcome: "success" as "success" | "failure" | "pending",
    formatOutput: "error: invalid expression\n  --> /test/example.simf:2:3\n",
    onFormatSpawn: undefined as ((child: MockChild) => void) | undefined,
    cancellations: 0,
    kills: 0,
    outputChannelsCreated: 0,
    outputChannelsDisposed: 0,
    outputChannelsShown: [] as boolean[],
    output: [] as string[],
    activeTextEditor: { document } as Pick<vscode.TextEditor, "document"> | undefined,
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
    get activeTextEditor() { return host.activeTextEditor; },
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
        show(preserveFocus: boolean) {
          assert.equal(disposed, false, "Cannot show a disposed output channel");
          host.outputChannelsShown.push(preserveFocus);
        },
        dispose() {
          assert.equal(disposed, false, "Output channel must only be disposed once");
          disposed = true;
          host.outputChannelsDisposed += 1;
        },
      };
    },
    showErrorMessage: (error: unknown, ...actions: string[]) => {
      host.errors.push(error);
      host.errorActions.push(actions);
      return Promise.resolve(host.errorSelection);
    },
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
            child.stderr.emit("data", Buffer.from(host.formatOutput));
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
let documentModule: typeof import("./document");
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
  documentModule = loadModule("./document");
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

void test("active document selection preserves warnings and leaves preparation to the formatter", async (t) => {
  extensionModule.activate(context());
  host.activeTextEditor = undefined;
  await host.command();

  const save = t.mock.fn(async () => true);
  host.activeTextEditor = { document: { ...document, languageId: "plaintext", isDirty: true, save } };
  await host.command();

  assert.deepEqual(host.warnings, [
    "No active file to format",
    "Current file is not a SimplicityHL file (.simf)",
  ]);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(host.outputChannelsCreated, 0);
  assert.equal(host.formatRuns, 0);
});

void test("the formatting command follows the shared save policy and saves only once", async (t) => {
  const save = t.mock.fn(async () => true);
  host.activeTextEditor = { document: { ...document, isDirty: true, save } };
  extensionModule.activate(context());

  host.settings["formatter.autoSaveBeforeFormat"] = false;
  await host.command();
  assert.equal(save.mock.callCount(), 0);
  assert.equal(host.formatRuns, 0);
  assert.deepEqual(host.errors, ["Save the SimplicityHL document before formatting it."]);
  assert.deepEqual(host.warnings, []);

  host.settings["formatter.autoSaveBeforeFormat"] = true;
  await host.command();
  assert.equal(save.mock.callCount(), 1);
  assert.equal(host.formatRuns, 1);
  assert.equal(host.errors.length, 1);
});

void test("the formatting provider prepares its supplied document independently of the active editor", async (t) => {
  const saveActive = t.mock.fn(async () => true);
  const saveTarget = t.mock.fn(async () => true);
  const target: vscode.TextDocument = {
    ...document,
    uri: { scheme: "file", fsPath: "/test/other.simf" } as vscode.Uri,
    isDirty: true,
    save: saveTarget,
  };
  host.settings["formatter.autoSaveBeforeFormat"] = true;
  extensionModule.activate(context());

  for (const activeTextEditor of [
    undefined,
    { document: { ...document, languageId: "plaintext", isDirty: true, save: saveActive } },
  ]) {
    host.activeTextEditor = activeTextEditor;
    assert.deepEqual(await host.provider.provideDocumentFormattingEdits(
      target,
      { tabSize: 2, insertSpaces: true },
      { isCancellationRequested: false } as vscode.CancellationToken,
    ), []);
    assert.equal(host.formatArgs[0], target.uri.fsPath);
  }

  assert.equal(saveTarget.mock.callCount(), 2);
  assert.equal(saveActive.mock.callCount(), 0);
  assert.deepEqual(host.errors, []);
  assert.deepEqual(host.warnings, []);
});

void test("shared preparation returns validation errors without displaying notifications", async (t) => {
  const save = t.mock.fn(async () => true);
  const invalidDocument = { ...document, languageId: "plaintext", isDirty: true, save };
  const options = { action: "format", saveBeforeAction: true, requireFilePath: true, requireSaved: true } as const;

  assert.deepEqual(await documentModule.prepareSimplicityHLDocument(invalidDocument, options), {
    error: "Current file is not a SimplicityHL file (.simf)",
  });
  assert.equal(save.mock.callCount(), 0);
  assert.deepEqual(host.errors, []);
  assert.deepEqual(host.warnings, []);

  const formatter = new formatterModule.SimplicityHLFormatter({ shouldUpdate: async () => false });
  context().subscriptions.push(formatter);
  assert.deepEqual(await formatter.formatDocument(invalidDocument), {
    success: false,
    output: "Current file is not a SimplicityHL file (.simf)",
  });
  assert.deepEqual(host.errors, ["Current file is not a SimplicityHL file (.simf)"]);
  assert.deepEqual(host.errorActions, [[]]);
  assert.equal(host.formatRuns, 0);
});

void test("active document preparation preserves compilation save behavior", async (t) => {
  const save = t.mock.fn(async () => false);
  const dirtyDocument = { ...document, isDirty: true, save };
  host.activeTextEditor = { document: dirtyDocument };

  assert.equal(await documentModule.getActiveSimplicityHLDocument({
    action: "compile", saveBeforeAction: false, failIfSaveFails: true,
  }), dirtyDocument);
  assert.equal(save.mock.callCount(), 0);

  assert.equal(await documentModule.getActiveSimplicityHLDocument({
    action: "compile", saveBeforeAction: true, failIfSaveFails: true,
  }), undefined);
  assert.deepEqual(host.warnings, ["Save the SimplicityHL document before compiling it."]);

  assert.equal(await documentModule.getActiveSimplicityHLDocument({
    action: "compile", saveBeforeAction: true, failIfSaveFails: false,
  }), dirtyDocument);
  assert.equal(save.mock.callCount(), 2);
  assert.equal(host.warnings.length, 1);
});

void test("active document selection does not forward preparation-only options", async () => {
  const dirtyDocument = { ...document, isDirty: true };
  host.activeTextEditor = { document: dirtyDocument };
  const options = { action: "compile", saveBeforeAction: false, requireSaved: true } as const;

  assert.equal(await documentModule.getActiveSimplicityHLDocument(options), dirtyDocument);
  assert.deepEqual(await documentModule.prepareSimplicityHLDocument(dirtyDocument, options), {
    error: "Save the SimplicityHL document before compiling it.",
  });
  assert.deepEqual(host.warnings, []);
});

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

void test("formatter installation enables autoupdate by default", async (t) => {
  delete host.settings["formatter.disableAutoupdate"];
  const shouldUpdate = t.mock.fn(async () => true);
  assert.equal(await formatterInstall.getSimfmtPath({ shouldUpdate }), "/test/bin/simfmt");
  assert.equal(shouldUpdate.mock.callCount(), 1);
  assert.deepEqual(host.installs, ["simfmt"]);
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

void test("formatter failures offer output without opening it when the notification is dismissed", async () => {
  host.formatOutcome = "failure";
  extensionModule.activate(context());
  const result = await host.provider.provideDocumentFormattingEdits(
    document,
    { tabSize: 2, insertSpaces: true },
    { isCancellationRequested: false } as vscode.CancellationToken,
  );
  assert.equal(result, undefined);
  assert.deepEqual(host.errors, ["Formatting failed: invalid expression"]);
  assert.deepEqual(host.errorActions, [["Show Output"]]);
  assert.deepEqual(host.outputChannelsShown, []);
  assert.ok(host.output.join("\n").includes("invalid expression"));
});

void test("formatter setup failures preserve complete errors and can show their output", async (t) => {
  const message = `Unable to prepare simfmt: ${"details ".repeat(100)}\nUnderlying error`;
  t.mock.method(formatterInstall, "getSimfmtPath", async () => { throw new Error(message); });
  host.errorSelection = "Show Output";
  const formatter = new formatterModule.SimplicityHLFormatter({ shouldUpdate: async () => false });
  context().subscriptions.push(formatter);

  assert.deepEqual(await formatter.formatDocument(document), { success: false, output: message });
  assert.ok(host.output.join("\n").includes(message));
  assert.equal(host.errors.length, 1);
  const notification = String(host.errors[0]);
  assert.ok(notification.length <= 200);
  assert.match(notification, /^Formatting failed: Unable to prepare simfmt: .*…$/);
  assert.deepEqual(host.errorActions, [["Show Output"]]);
  assert.deepEqual(host.outputChannelsShown, [true]);
  assert.equal(host.formatRuns, 0);
});

for (const disposeBeforeAction of [false, true]) {
  void test(`formatter errors return before the output action, with disposal ${disposeBeforeAction}`, async () => {
    host.formatOutcome = "failure";
    host.formatOutput = `error: ${"invalid expression ".repeat(100)}\n  --> /test/example.simf:2:3\n`;
    let selectAction: (action: string) => void;
    host.errorSelection = new Promise<string>((resolve) => { selectAction = resolve; });
    const formatter = new formatterModule.SimplicityHLFormatter({ shouldUpdate: async () => false });
    context().subscriptions.push(formatter);

    const result = await formatter.formatDocument(document);
    assert.equal(result.success, false);
    assert.equal(result.output, host.formatOutput + "simfmt exited with code 1.\n");
    assert.ok(host.output.join("\n").includes(host.formatOutput));
    assert.match(String(host.errors[0]), /^Formatting failed: invalid expression .*…$/);
    assert.deepEqual(host.errorActions, [["Show Output"]]);
    assert.deepEqual(host.outputChannelsShown, []);

    if (disposeBeforeAction) formatter.dispose();
    selectAction("Show Output");
    await host.errorSelection;
    assert.deepEqual(host.outputChannelsShown, disposeBeforeAction ? [] : [true]);
  });
}

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
  assert.deepEqual(await formatter.formatDocument(dirtyDocument), {
    success: false,
    output: "Save the SimplicityHL document before formatting it.",
  });
  assert.deepEqual(host.errors, ["Save the SimplicityHL document before formatting it."]);
  assert.deepEqual(host.errorActions, [[]]);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(host.formatRuns, 0);

  host.settings["formatter.autoSaveBeforeFormat"] = true;
  assert.equal((await formatter.formatDocument(dirtyDocument)).success, true);
  assert.equal(save.mock.callCount(), 1);
  assert.equal(host.formatRuns, 1);
});

void test("formatter uses the same save warning for missing paths and failed saves", async () => {
  host.settings["formatter.autoSaveBeforeFormat"] = true;
  const formatter = new formatterModule.SimplicityHLFormatter({ shouldUpdate: async () => false });
  context().subscriptions.push(formatter);
  const invalidDocuments = [
    { ...document, uri: { scheme: "untitled", fsPath: "/test/example.simf" } },
    { ...document, uri: { scheme: "file", fsPath: "" } },
    { ...document, isDirty: true, save: async () => false },
  ] as vscode.TextDocument[];

  for (const invalidDocument of invalidDocuments) {
    assert.deepEqual(await formatter.formatDocument(invalidDocument), {
      success: false,
      output: "Save the SimplicityHL document before formatting it.",
    });
    assert.deepEqual(host.output, ["Save the SimplicityHL document before formatting it."]);
  }
  assert.deepEqual(host.errors, invalidDocuments.map(() =>
    "Save the SimplicityHL document before formatting it.",
  ));
  assert.deepEqual(host.errorActions, invalidDocuments.map(() => []));
  assert.deepEqual(host.outputChannelsShown, []);
  assert.equal(host.formatRuns, 0);
});
