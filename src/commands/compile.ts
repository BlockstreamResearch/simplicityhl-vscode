// Command handlers for SimplicityHL compilation.
// Registers commands accessible via Command Palette and keybindings.

import * as vscode from "vscode";
import * as path from "node:path";
import type { CompileResult, SimplicityHLCompiler } from "../compiler";
import type { CompileOptions } from "../compiler/args";
import {
  COMMAND_IDS,
  CONFIGURATION_SECTION,
  LANGUAGE_IDS,
  SETTINGS,
} from "../contracts";

function showCompilationFailed(): void {
  vscode.window.showErrorMessage(
    "Compilation failed. See the SimplicityHL Compiler output for details."
  );
}

// Validates that the active editor contains a SimplicityHL file
async function getSimplicityHLDocument(): Promise<vscode.TextDocument | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active file to compile");
    return undefined;
  }

  const document = editor.document;
  if (document.languageId !== LANGUAGE_IDS.source) {
    vscode.window.showWarningMessage("Current file is not a SimplicityHL file (.simf)");
    return undefined;
  }

  // Auto-save before compile if enabled
  const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  const autoSave = config.get<boolean>(
    SETTINGS.autoSaveBeforeCompile.key,
    SETTINGS.autoSaveBeforeCompile.default,
  );
  if (autoSave && document.isDirty) {
    const saved = await document.save();
    if (!saved) {
      void vscode.window.showWarningMessage(
        "SimplicityHL compilation canceled because the file could not be saved.",
      );
      return undefined;
    }
  }

  return document;
}

async function compileActiveDocument(
  compiler: () => SimplicityHLCompiler,
  options: CompileOptions = {},
): Promise<CompileResult | undefined> {
  const document = await getSimplicityHLDocument();
  return document && compiler().compileFile(document.uri.fsPath, options);
}

// Register all compile-related commands
export function registerCompileCommands(
  context: vscode.ExtensionContext,
  compiler: () => SimplicityHLCompiler,
): void {
  const compileFileCommand = vscode.commands.registerCommand(
    COMMAND_IDS.compileFile,
    async () => {
      const result = await compileActiveDocument(compiler);
      if (!result) return;

      if (result.success) {
        // Offer to copy output to clipboard
        const action = await vscode.window.showInformationMessage(
          "SimplicityHL compiled successfully!",
          "Copy Program",
          "Dismiss"
        );

        if (action === "Copy Program" && result.program) {
          await vscode.env.clipboard.writeText(result.program);
          vscode.window.showInformationMessage("Program copied to clipboard");
        }
      } else {
        showCompilationFailed();
      }
    }
  );

  const compileDebugCommand = vscode.commands.registerCommand(
    COMMAND_IDS.compileFileDebug,
    async () => {
      const result = await compileActiveDocument(compiler, { debug: true });
      if (!result) return;

      if (result.success) {
        vscode.window.showInformationMessage("Compiled with debug symbols!");
      } else {
        showCompilationFailed();
      }
    }
  );

  const compileWithWitnessCommand = vscode.commands.registerCommand(
    COMMAND_IDS.compileWithWitness,
    async () => {
      const document = await getSimplicityHLDocument();
      if (!document) return;

      const simfPath = document.uri.fsPath;
      // Default: look for .wit file with same name
      const defaultWitPath = simfPath.replace(/\.simf$/, ".wit");

      let witnessFile: string | undefined;
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(defaultWitPath));
        witnessFile = defaultWitPath;
      } catch {
        // No default witness file, prompt user to select one
        const selected = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { "Witness Files": ["wit", "json"] },
          defaultUri: vscode.Uri.file(path.dirname(simfPath)),
          title: "Select Witness File",
        });

        if (selected?.[0]) {
          witnessFile = selected[0].fsPath;
        }
      }

      if (!witnessFile) {
        vscode.window.showWarningMessage("No witness file selected");
        return;
      }

      const result = await compiler().compileFile(simfPath, { witnessFile });

      if (result.success) {
        const action = await vscode.window.showInformationMessage(
          "Program satisfied with witness!",
          "Copy Program",
          "Copy Witness",
          "Dismiss"
        );

        if (action === "Copy Program" && result.program) {
          await vscode.env.clipboard.writeText(result.program);
          vscode.window.showInformationMessage("Program copied to clipboard");
        } else if (action === "Copy Witness" && result.witness) {
          await vscode.env.clipboard.writeText(result.witness);
          vscode.window.showInformationMessage("Witness copied to clipboard");
        }
      } else {
        showCompilationFailed();
      }
    }
  );

  const compileJsonCommand = vscode.commands.registerCommand(
    COMMAND_IDS.compileJson,
    async () => {
      const result = await compileActiveDocument(compiler, { json: true });
      if (!result) return;

      if (result.success && result.program) {
        // Show JSON output in a new untitled document
        const jsonOutput = JSON.stringify(
          {
            program: result.program,
            witness: result.witness ?? null,
          },
          null,
          2
        );
        const doc = await vscode.workspace.openTextDocument({
          content: jsonOutput,
          language: "json",
        });
        await vscode.window.showTextDocument(doc);
      } else {
        showCompilationFailed();
      }
    }
  );

  context.subscriptions.push(
    compileFileCommand,
    compileDebugCommand,
    compileWithWitnessCommand,
    compileJsonCommand,
  );
}
