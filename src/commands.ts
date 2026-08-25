import { ExtensionContext, commands } from "vscode";
import { LspClient } from "./lsp/client";

export function registerRestartCommand(
  context: ExtensionContext,
  lspClient: LspClient
) {
  const command = commands.registerCommand(
    "simplicityhl.restartServer",
    async () => {
      await lspClient.restart();
    }
  );

  context.subscriptions.push(command);
}
