// SimplicityHL document formatting backed by the external `simfmt` binary.

import * as cp from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import { findExecutable } from "./find_executable";

const FORMATTER_ARGS = ["--emit", "stdout", "--quiet", "--color", "never"];

// Registers the native VS Code "Format Document" provider for .simf files.
export function registerFormattingProvider(context: vscode.ExtensionContext): void {
  const formatter = new SimplicityHLFormatter();
  const provider = vscode.languages.registerDocumentFormattingEditProvider(
    { language: "simplicityhl" },
    formatter,
  );

  context.subscriptions.push(formatter, provider);
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

    if (document.uri.scheme === "untitled") {
      return this.fail("Save the SimplicityHL document before formatting it.");
    }

    try {
      const originalText = document.getText();
      const formattedText = await this.format(document, originalText, token);

      if (formattedText === undefined || formattedText === originalText) {
        return undefined;
      }

      return [
        vscode.TextEdit.replace(
          new vscode.Range(
            document.positionAt(0),
            document.positionAt(originalText.length),
          ),
          formattedText,
        ),
      ];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.fail(message);
    }
  }

  private async format(
    document: vscode.TextDocument,
    input: string,
    token: vscode.CancellationToken,
  ): Promise<string | undefined> {
    const formatterPath = getSimfmtPath();
    const cwd = path.dirname(document.uri.fsPath);

    this.outputChannel.clear();
    this.outputChannel.appendLine(`Formatting: ${document.uri.fsPath}`);
    this.outputChannel.appendLine(`Command: ${formatterPath} ${FORMATTER_ARGS.join(" ")}`);
    this.outputChannel.appendLine("");

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let cancelled = token.isCancellationRequested;
      let formatterProcess: cp.ChildProcess | undefined;

      const cancellation = token.onCancellationRequested(() => {
        cancelled = true;
        formatterProcess?.kill();
      });

      const finish = (result?: string, error?: Error) => {
        if (settled) return;
        settled = true;
        cancellation.dispose();

        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      };

      try {
        const process = cp.spawn(formatterPath, FORMATTER_ARGS, { cwd });
        formatterProcess = process;

        process.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        process.stderr?.on("data", (data: Buffer) => {
          const text = data.toString();
          stderr += text;
          this.outputChannel.append(text);
        });

        process.stdin?.on("error", (error) => {
          if (cancelled) {
            finish();
            return;
          }
          finish(undefined, new Error(`Unable to send input to simfmt: ${error.message}`));
        });

        process.on("error", (error) => {
          if (cancelled) {
            finish();
            return;
          }
          finish(undefined, new Error(`Unable to start simfmt: ${error.message}`));
        });

        process.on("close", (code) => {
          if (cancelled) {
            finish();
            return;
          }

          if (code === 0) {
            finish(stdout);
            return;
          }

          const detail = stderr.trim() || `simfmt exited with code ${code ?? "unknown"}.`;
          finish(undefined, new Error(detail));
        });

        process.stdin?.end(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finish(undefined, new Error(`Unable to start simfmt: ${message}`));
      }
    });
  }

  private fail(message: string): never {
    this.outputChannel.appendLine(`Formatting failed: ${message}`);
    this.outputChannel.show(true);
    void vscode.window.showErrorMessage(`SimplicityHL formatting failed: ${message}`);
    throw new Error(message);
  }
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
