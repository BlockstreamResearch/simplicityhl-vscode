// SimplicityHL VSCode Extension entry point.
// Initializes LSP client and registers all extension features.

import { ExtensionContext, commands } from "vscode";

import { LspClient } from "./lsp/client";
import { SimplicityHLCompiler } from "./compiler";
import { SimplicityHLFormatter } from "./format";
import { registerCompileCommands } from "./commands/compile";
import { registerFormattingCommands } from "./commands/format";
import { COMMAND_IDS, FORMATTER_UPDATE_CACHE_KEY } from "./contracts";
import { registerTaskProvider } from "./tasks/provider";
import { DailyUpdateCache } from "./update_cache";

let client: LspClient | undefined;
let compiler: SimplicityHLCompiler | undefined;
let formatter: SimplicityHLFormatter | undefined;

export function activate(context: ExtensionContext): void {
  // Initialize LSP client for language intelligence (also shows status bar)
  const lspClient = new LspClient(context);
  client = lspClient;
  void lspClient.start();

  // Register all commands and providers
  context.subscriptions.push(commands.registerCommand(
    COMMAND_IDS.restartServer,
    () => lspClient.restart(),
  ));
  // Compile commands (Cmd+Shift+B, etc.)
  registerCompileCommands(context, () => {
    if (!compiler) {
      compiler = new SimplicityHLCompiler();
      context.subscriptions.push(compiler);
    }
    return compiler;
  });
  registerTaskProvider(context);      // Task integration (Tasks: Run Task)

  const updateCache = new DailyUpdateCache(context.globalState, FORMATTER_UPDATE_CACHE_KEY);
  registerFormattingCommands(context, () => {
    if (!formatter) {
      formatter = new SimplicityHLFormatter(updateCache);
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
