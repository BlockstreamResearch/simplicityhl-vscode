// Formatter interface for SimplicityHL.
// Wraps the `simfmt` binary and reports its output for VS Code integration.

import * as vscode from "vscode";
import * as cp from "node:child_process";
import * as path from "node:path";
import { getSimfmtPath } from "./install";
import { getFailureNotification } from "./output";
import {
  CONFIGURATION_SECTION,
  OUTPUT_CHANNEL_NAMES,
  SETTINGS,
} from "../contracts";
import { prepareSimplicityHLDocument, DocumentAction, } from "./document";
import type { BinaryUpdateEventState } from "../update/binary_update_state";

const FORMATTER_ARGS = ["--color", "never"];
const SHUTDOWN_MESSAGE = "Formatting canceled during extension shutdown";
const SHOW_OUTPUT_ACTION = "Show Output";

export interface FormatResult {
  success: boolean;
  output: string;
}

export class SimplicityHLFormatter implements vscode.DocumentFormattingEditProvider, vscode.Disposable {
  private readonly outputChannel = vscode.window.createOutputChannel(
    OUTPUT_CHANNEL_NAMES.formatter,
  );
  private readonly activeChildren = new Set<cp.ChildProcess>();
  private disposed = false;

  public constructor(private readonly updateState: BinaryUpdateEventState) {}

  // Release resources and stop formatter processes owned by this instance.
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const child of this.activeChildren) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    }
    this.outputChannel.dispose();
  }

  // Handles VS Code's native Format Document request for SimplicityHL files.
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

  // Saves, validates, and formats a single SimplicityHL document.
  public async formatDocument(document: vscode.TextDocument): Promise<FormatResult> {
    if (this.disposed) {
      return { success: false, output: SHUTDOWN_MESSAGE };
    }
    this.outputChannel.clear();

    const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const prepared = await prepareSimplicityHLDocument(document, {
      action: DocumentAction.Format,
      saveBeforeAction: config.get<boolean>(
        SETTINGS.autoSaveBeforeFormat.key,
        SETTINGS.autoSaveBeforeFormat.default,
      ),
      requireFilePath: true,
      requireSaved: true,
    });
    if (this.disposed) {
      return { success: false, output: SHUTDOWN_MESSAGE };
    }
    if ("error" in prepared) {
      return this.failShort(prepared.error);
    }

    let formatterPath: string;
    try {
      formatterPath = await getSimfmtPath(this.updateState);
    } catch (error) {
      return this.fail(getErrorMessage(error));
    }
    if (this.disposed) {
      return { success: false, output: SHUTDOWN_MESSAGE };
    }

    const filePath = prepared.document.uri.fsPath;
    const args = [filePath, ...FORMATTER_ARGS];
    this.outputChannel.appendLine(`Formatting: ${filePath}`);
    this.outputChannel.appendLine(`Command: ${formatCommand(formatterPath, args)}`);
    this.outputChannel.appendLine("");

    const result = await this.runFormatter(formatterPath, args, path.dirname(filePath));
    if (this.disposed) return result;
    if (result.success) {
      this.outputChannel.appendLine(`Formatting successful: ${filePath}`);
      return result;
    }

    this.outputChannel.appendLine("Formatting failed. See the diagnostics above for details.");
    this.showFailureNotification(result.output);

    return result;
  }

  // Runs simfmt and captures its combined stdout/stderr output.
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
          if (!this.disposed) this.outputChannel.append(message);
        }

        resolve({ success, output });
      };

      try {
        const process = cp.spawn(formatterPath, args, { cwd, shell: false });
        this.activeChildren.add(process);
        const appendOutput = (data: Buffer) => {
          const text = data.toString();
          output += text;
          if (!this.disposed) this.outputChannel.append(text);
        };

        process.stdout?.on("data", appendOutput);
        process.stderr?.on("data", appendOutput);

        process.on("error", (error) => {
          finish(false, `Unable to start simfmt: ${error.message}\n`);
        });

        process.on("close", (code) => {
          this.activeChildren.delete(process);
          if (this.disposed) {
            finish(false, `${SHUTDOWN_MESSAGE}\n`);
            return;
          }
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

  // Reports a self-contained validation message without additional context.
  private failShort(message: string): FormatResult {
    if (!this.disposed) {
      this.outputChannel.appendLine(message);
      void vscode.window.showErrorMessage(message);
    }

    return { success: false, output: message };
  }

  // Reports a pre-run formatting failure to the user and output channel.
  private fail(message: string): FormatResult {
    if (!this.disposed) {
      this.outputChannel.appendLine(`Formatting failed: "${message}".`);
      this.showFailureNotification(message);
    }

    return { success: false, output: message };
  }

  // Offers full details without waiting for the user to dismiss the notification.
  private showFailureNotification(output: string): void {
    void vscode.window.showErrorMessage(getFailureNotification(output), SHOW_OUTPUT_ACTION).then((action) => {
      if (action === SHOW_OUTPUT_ACTION && !this.disposed) {
        this.outputChannel.show(true);
      }
    });
  }
}

// Builds a copyable command string for the formatter output channel.
function formatCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((argument) => (/\s/.test(argument) ? JSON.stringify(argument) : argument))
    .join(" ");
}

// Normalizes thrown values into user-readable strings.
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
