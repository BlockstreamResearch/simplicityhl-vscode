// SimplicityHL VSCode Extension entry point.
// Initializes LSP client and registers all extension features.

import { ExtensionContext, commands } from "vscode";

import { LspClient } from "./lsp/client";
import { SimplicityHLCompiler } from "./compiler";
import { registerCompileCommands } from "./commands/compile";
import { COMMAND_IDS } from "./contracts";
import { registerTaskProvider } from "./tasks/provider";

let client: LspClient;
let compiler: SimplicityHLCompiler | undefined;

export function activate(context: ExtensionContext): void {
  // Initialize LSP client for language intelligence (also shows status bar)
  client = new LspClient(context);
  void client.start();

  // Register all commands and providers
  context.subscriptions.push(commands.registerCommand(
    COMMAND_IDS.restartServer,
    () => client.restart(),
  ));
  // Compile commands (Cmd+Shift+B, etc.)
  registerCompileCommands(context, () => {
    compiler ??= new SimplicityHLCompiler();
    return compiler;
  });
  registerTaskProvider(context);      // Task integration (Tasks: Run Task)
}

export async function deactivate(): Promise<void> {
  const activeCompiler = compiler;
  compiler = undefined;
  activeCompiler?.dispose();
  await client?.shutdown();
}
