// Shared helpers for selecting and preparing SimplicityHL documents.

import * as vscode from "vscode";
import { LANGUAGE_IDS } from "../contracts";

export enum DocumentAction {
  Compile = "compile",
  Format = "format",
}

interface ActiveDocumentOptions {
  action: DocumentAction;
  saveBeforeAction?: boolean;
  requireFilePath?: boolean;
  failIfSaveFails?: boolean;
}

interface DocumentPreparationOptions {
  action: DocumentAction;
  saveBeforeAction?: boolean;
  requireFilePath?: boolean;
  failIfSaveFails?: boolean;
  // Reject dirty documents when autosave is disabled or saving fails.
  requireSaved?: boolean;
}

type DocumentPreparationResult =
  | { document: vscode.TextDocument }
  | { error: string };

export async function getActiveSimplicityHLDocument(
  options: ActiveDocumentOptions,
): Promise<vscode.TextDocument | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(`No active file to ${options.action}`);
    return undefined;
  }

  const preparationOptions: DocumentPreparationOptions = {
    action: options.action,
    saveBeforeAction: options.saveBeforeAction,
    requireFilePath: options.requireFilePath,
    failIfSaveFails: options.failIfSaveFails,
  };
  const result = await prepareSimplicityHLDocument(editor.document, preparationOptions);
  if ("error" in result) {
    void vscode.window.showWarningMessage(result.error);
    return undefined;
  }

  return result.document;
}

// Validates and optionally saves the supplied document without displaying notifications.
export async function prepareSimplicityHLDocument(
  document: vscode.TextDocument,
  options: DocumentPreparationOptions,
): Promise<DocumentPreparationResult> {
  if (document.languageId !== LANGUAGE_IDS.source) {
    return { error: "Current file is not a SimplicityHL file (.simf)" };
  }

  if (options.requireFilePath && (document.uri.scheme !== "file" || !document.uri.fsPath)) {
    return { error: getSaveWarningMessage(options.action) };
  }

  if (options.requireSaved && document.isDirty && !options.saveBeforeAction) {
    return { error: getSaveWarningMessage(options.action) };
  }

  if (options.saveBeforeAction && document.isDirty) {
    const saved = await document.save();
    if (!saved && (options.failIfSaveFails || options.requireSaved)) {
      return { error: getSaveWarningMessage(options.action) };
    }
  }

  return { document };
}

function getSaveWarningMessage(action: DocumentPreparationOptions["action"]): string {
  let actionName: string;
  switch (action) {
    case DocumentAction.Compile:
      actionName = "compiling";
      break;
    case DocumentAction.Format:
      actionName = "formatting";
      break;
  }

  return `Save the SimplicityHL document before ${actionName} it.`;
}
