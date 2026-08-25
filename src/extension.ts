// SimplicityHL VSCode Extension entry point.
// Initializes LSP client and registers all extension features.

import { ExtensionContext } from "vscode";

import { LspClient } from "./lsp/client";
import { registerRestartCommand } from "./commands";
import { SimplicityHLCompiler } from "./compiler";
import { registerCompileCommands } from "./commands/compile";
import { registerTaskProvider } from "./tasks/provider";

let client: LspClient;
let compiler: SimplicityHLCompiler | undefined;

export function activate(context: ExtensionContext): void {
  // Initialize LSP client for language intelligence (also shows status bar)
  client = new LspClient(context);
  void client.start();

  // Register all commands and providers
  registerRestartCommand(context, client);
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
