// SimplicityHL VSCode Extension entry point.
// Initializes LSP client and registers all extension features.

import { ExtensionContext, commands } from "vscode";

import { LspClient } from "./lsp/client";
import { SimplicityHLCompiler } from "./compiler";
import { registerCompileCommands } from "./commands/compile";
import { SimplicityHLFormatter } from "./format";
import { getSimfmtPath } from "./format/install";
import { registerFormattingCommands } from "./commands/format";
import { COMMAND_IDS, ManagedBinary } from "./contracts";
import { registerTaskProvider } from "./tasks/provider";
import { BinaryUpdateEventState, } from "./update/binary_update_state";

let client: LspClient | undefined;
let compiler: SimplicityHLCompiler | undefined;
let formatter: SimplicityHLFormatter | undefined;

export function activate(context: ExtensionContext): void {
  const updateState = updateSimfmt(context);

  // Initialize LSP client for language intelligence (also shows status bar)
  const lspClient = new LspClient(context);
  client = lspClient;
  void lspClient.start();

  // Register all commands and providers
  context.subscriptions.push(
    commands.registerCommand(COMMAND_IDS.restartServer, () =>
      lspClient.restart(),
    ),
  );
  // Compile commands (Cmd+Shift+B, etc.)
  registerCompileCommands(context, () => {
    if (!compiler) {
      compiler = new SimplicityHLCompiler();
      context.subscriptions.push(compiler);
    }
    return compiler;
  });
  registerTaskProvider(context);      // Task integration (Tasks: Run Task)

  // Formatting commands (Cmd+Shift+F, etc.)
  registerFormattingCommands(context, () => {
    if (!formatter) {
      formatter = new SimplicityHLFormatter(updateState);
      context.subscriptions.push(formatter);
    }
    return formatter;
  });
}

export async function deactivate(): Promise<void> {
  const activeClient = client;
  const activeCompiler = compiler;
  const activeFormatter = formatter;
  client = undefined;
  compiler = undefined;
  formatter = undefined;
  activeCompiler?.dispose();
  activeFormatter?.dispose();
  await activeClient?.shutdown();
}

function updateSimfmt(context: ExtensionContext): BinaryUpdateEventState {
  const updateState = new BinaryUpdateEventState(context.globalState);
  void updateState
    .markPending(ManagedBinary.Simfmt)
    .then(() => getSimfmtPath(updateState))
    .catch((error) => {
      console.warn("Unable to update simfmt during extension activation.", error);
    });

  return updateState;
}
