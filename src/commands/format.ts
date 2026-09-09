// Command and native provider registration for SimplicityHL formatting.

import * as vscode from "vscode";
import { COMMAND_IDS, LANGUAGE_IDS } from "../contracts";

import { getActiveSimplicityHLDocument, DocumentAction } from "../format/document";
import type { SimplicityHLFormatter } from "../format";

export function registerFormattingCommands(
  context: vscode.ExtensionContext,
  formatter: () => SimplicityHLFormatter,
): void {
  const formatFileCommand = vscode.commands.registerCommand(
    COMMAND_IDS.formatFile,
    async () => {
      const document = await getActiveSimplicityHLDocument({
        action: DocumentAction.Format,
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
