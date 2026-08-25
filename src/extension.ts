// SimplicityHL VSCode Extension entry point.
// Initializes LSP client and registers all extension features.

import { ExtensionContext } from "vscode";

import { LspClient } from "./lsp/client";
import { registerRestartCommand } from "./commands";
import { disposeCompiler } from "./compiler";
import { registerCompileCommands } from "./commands/compile";
import { disposeStatusBar } from "./lsp/status";
import { registerTaskProvider } from "./tasks/provider";

let client: LspClient;

export function activate(context: ExtensionContext): void {
  // Initialize LSP client for language intelligence (also shows status bar)
  client = new LspClient(context);
  void client.start();

  // Register all commands and providers
  registerRestartCommand(context, client);
  registerCompileCommands(context);  // Compile commands (Cmd+Shift+B, etc.)
  registerTaskProvider(context);      // Task integration (Tasks: Run Task)
}

export async function deactivate(): Promise<void> {
  disposeCompiler();
  try {
    await client?.stop();
  } finally {
    disposeStatusBar();
  }
}
