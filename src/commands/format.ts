// Command and native provider registration for SimplicityHL formatting.

import * as vscode from "vscode";
import {
  COMMAND_IDS,
  CONFIGURATION_SECTION,
  LANGUAGE_IDS,
  SETTINGS,
} from "../contracts";
import { getActiveSimplicityHLDocument } from "../document";
import type { SimplicityHLFormatter } from "../format";

export function registerFormattingCommands(
  context: vscode.ExtensionContext,
  formatter: () => SimplicityHLFormatter,
): void {
  const formatFileCommand = vscode.commands.registerCommand(
    COMMAND_IDS.formatFile,
    async () => {
      const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
      const document = await getActiveSimplicityHLDocument({
        action: "format",
        saveBeforeAction: config.get<boolean>(
          SETTINGS.autoSaveBeforeFormat.key,
          SETTINGS.autoSaveBeforeFormat.default,
        ),
        requireFilePath: true,
        failIfSaveFails: true,
      });
      if (!document) return;

      await formatter().formatDocument(document);
    },
  );

  const provider = vscode.languages.registerDocumentFormattingEditProvider(
    { language: LANGUAGE_IDS.source },
    {
      provideDocumentFormattingEdits(document, options, token) {
        if (token.isCancellationRequested) return undefined;
        return formatter().provideDocumentFormattingEdits(document, options, token);
      },
    },
  );

  context.subscriptions.push(formatFileCommand, provider);
}
