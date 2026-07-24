// Shared helpers for retrieving the active SimplicityHL document.

import * as vscode from "vscode";
import { LANGUAGE_IDS } from "./contracts";

interface ActiveDocumentOptions {
  action: "compile" | "format";
  saveBeforeAction?: boolean;
  requireFilePath?: boolean;
  failIfSaveFails?: boolean;
}

export async function getActiveSimplicityHLDocument(
  options: ActiveDocumentOptions,
): Promise<vscode.TextDocument | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(`No active file to ${options.action}`);
    return undefined;
  }

  const document = editor.document;
  if (document.languageId !== LANGUAGE_IDS.source) {
    void vscode.window.showWarningMessage("Current file is not a SimplicityHL file (.simf)");
    return undefined;
  }

  if (options.requireFilePath && (document.uri.scheme !== "file" || !document.uri.fsPath)) {
    void vscode.window.showWarningMessage(getSaveWarningMessage(options.action));
    return undefined;
  }

  if (options.saveBeforeAction && document.isDirty) {
    const saved = await document.save();
    if (!saved && options.failIfSaveFails) {
      void vscode.window.showWarningMessage(getSaveWarningMessage(options.action));
      return undefined;
    }
  }

  return document;
}

function getSaveWarningMessage(action: ActiveDocumentOptions["action"]): string {
  const actionName = action === "compile" ? "compiling" : "formatting";
  return `Save the SimplicityHL document before ${actionName} it.`;
}
