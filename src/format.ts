// Command handlers for SimplicityHL formatting.
// Runs the external `simfmt` binary against the current saved .simf file.

import * as cp from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import { getActiveSimplicityHLDocument } from "./document";
import { findExecutable } from "./find_executable";

const FORMATTER_ARGS = ["--color", "never"];
// Parses "error: ..." message from the stderr.
const DIAGNOSTIC_HEADER = /^error(?:\[[^\]]+\])?:\s*(.+)$/gm;
// Parses problematic place location from stderr to notify a user.
const DIAGNOSTIC_LOCATION = /^\s*-->\s+(.+):(\d+):(\d+)\s*$/m;

interface FormatResult {
  success: boolean;
  output: string;
}

interface FormatterDiagnostic {
  message: string;
  filePath: string;
  line: number;
  column: number;
}

// Saves the active editor so simfmt always receives a real file path.
async function getSimplicityHLDocument(): Promise<vscode.TextDocument | undefined> {
  return getActiveSimplicityHLDocument({
    action: "format",
    saveBeforeAction: true,
    requireFilePath: true,
    failIfSaveFails: true,
  });
}

// Registers the Format Current File command and the native VS Code formatter.
export function registerFormattingCommands(context: vscode.ExtensionContext): void {
  const formatter = new SimplicityHLFormatter();

  const formatFileCommand = vscode.commands.registerCommand(
    "simplicityhl.formatFile",
    async () => {
      const document = await getSimplicityHLDocument();
      if (!document) return;

      await formatter.formatDocument(document);
    },
  );

  const provider = vscode.languages.registerDocumentFormattingEditProvider(
    { language: "simplicityhl" },
    formatter,
  );

  context.subscriptions.push(formatter, formatFileCommand, provider);
}

class SimplicityHLFormatter implements vscode.DocumentFormattingEditProvider, vscode.Disposable {
  private readonly outputChannel = vscode.window.createOutputChannel("SimplicityHL Formatter");

  public dispose(): void {
    this.outputChannel.dispose();
  }

  public async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.TextEdit[] | undefined> {
    if (token.isCancellationRequested) {
      return undefined;
    }

    const result = await this.formatDocument(document);
    return result.success ? [] : undefined;
  }

  public async formatDocument(document: vscode.TextDocument): Promise<FormatResult> {
    this.outputChannel.clear();

    if (document.uri.scheme !== "file" || !document.uri.fsPath) {
      return this.fail("Save the SimplicityHL document before formatting it.");
    }

    if (document.isDirty && !(await document.save())) {
      return this.fail("Save the SimplicityHL document before formatting it.");
    }

    let formatterPath: string;
    try {
      formatterPath = getSimfmtPath();
    } catch (error) {
      return this.fail(getErrorMessage(error));
    }

    const filePath = document.uri.fsPath;
    const args = [filePath, ...FORMATTER_ARGS];
    this.outputChannel.appendLine(`Formatting: ${filePath}`);
    this.outputChannel.appendLine(`Command: ${formatCommand(formatterPath, args)}`);
    this.outputChannel.appendLine("");

    const result = await this.runFormatter(formatterPath, args, path.dirname(filePath));
    if (result.success) {
      this.outputChannel.appendLine(`Formatting successful: ${filePath}`);
      void vscode.window.showInformationMessage("SimplicityHL formatted successfully!");
      return result;
    }

    const diagnostics = parseFormatterDiagnostics(result.output);

    this.outputChannel.appendLine("Formatting failed. See the diagnostics above for details.");
    void vscode.window.showErrorMessage(getFailureNotification(diagnostics, result.output));

    return result;
  }

  private async runFormatter(
    formatterPath: string,
    args: string[],
    cwd: string,
  ): Promise<FormatResult> {
    return new Promise((resolve) => {
      let output = "";
      let settled = false;

      const finish = (success: boolean, message?: string) => {
        if (settled) return;
        settled = true;

        if (message) {
          output += message;
          this.outputChannel.append(message);
        }

        resolve({ success, output });
      };

      try {
        const process = cp.spawn(formatterPath, args, { cwd });
        const appendOutput = (data: Buffer) => {
          const text = data.toString();
          output += text;
          this.outputChannel.append(text);
        };

        process.stdout?.on("data", appendOutput);
        process.stderr?.on("data", appendOutput);

        process.on("error", (error) => {
          finish(false, `Unable to start simfmt: ${error.message}\n`);
        });

        process.on("close", (code) => {
          if (code === 0) {
            finish(true);
            return;
          }

          finish(false, `simfmt exited with code ${code ?? "unknown"}.\n`);
        });
      } catch (error) {
        finish(false, `Unable to start simfmt: ${getErrorMessage(error)}\n`);
      }
    });
  }

  private fail(message: string): FormatResult {
    this.outputChannel.appendLine(`Formatting failed: ${message}`);
    void vscode.window.showErrorMessage(`SimplicityHL formatting failed: ${message}`);
    return { success: false, output: message };
  }
}

// Parses simfmt's compiler-style diagnostics, including `--> path:line:column` locations.
export function parseFormatterDiagnostics(output: string): FormatterDiagnostic[] {
  const headers = [...output.matchAll(DIAGNOSTIC_HEADER)];

  return headers.flatMap((header, index) => {
    const blockStart = (header.index ?? 0) + header[0].length;
    const blockEnd = headers[index + 1]?.index ?? output.length;
    const block = output.slice(blockStart, blockEnd);
    const location = block.match(DIAGNOSTIC_LOCATION);

    if (!location) {
      return [];
    }

    return [{
      message: header[1].trim(),
      filePath: location[1],
      line: Number(location[2]),
      column: Number(location[3]),
    }];
  });
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((argument) => (/\s/.test(argument) ? JSON.stringify(argument) : argument))
    .join(" ");
}

function getFailureMessage(output: string): string {
  const lines = output.trim().split(/\r?\n/);
  return lines[0] || "simfmt failed without reporting an error.";
}

function getFailureNotification(diagnostics: FormatterDiagnostic[], output: string): string {
  if (diagnostics.length === 0) {
    return `SimplicityHL formatting failed: ${getFailureMessage(output)}`;
  }

  const messages = diagnostics
    .map((diagnostic) => {
      const fileName = path.basename(diagnostic.filePath);
      return `${fileName}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`;
    })
    .join("\n");

  return `SimplicityHL formatting failed:\n${messages}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Locate the simfmt binary using an explicit user setting before PATH discovery.
export function getSimfmtPath(): string {
  const config = vscode.workspace.getConfiguration("simplicityhl");
  const configuredPath = config.get<string>("formatter.path");
  if (configuredPath?.trim()) {
    return configuredPath.trim();
  }

  const formatterPath = findExecutable("simfmt");
  if (formatterPath) {
    return formatterPath;
  }

  throw new Error(
    "simfmt formatter not found. Install simfmt and add it to PATH, or set simplicityhl.formatter.path.",
  );
}
