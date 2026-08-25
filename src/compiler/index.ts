// Compiler interface for SimplicityHL.
// Wraps the `simc` binary and parses its output for VSCode integration.

import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "node:path";
import { compilerArguments, type CompileOptions } from "./args";
import { parseCompilerOutput } from "./output";
import { findExecutable } from "../find_executable";
import { getExperimentalFeatures } from "../settings";

// Result of a compilation attempt
export interface CompileResult {
  success: boolean;
  program?: string;     // Base64 encoded Simplicity program
  witness?: string;     // Base64 encoded witness (if provided)
  error?: string;       // Error message if compilation failed
}

// Main compiler class - manages simc invocations
export class SimplicityHLCompiler {
  private outputChannel: vscode.OutputChannel;

  constructor() {
    // Output channel shows raw compiler output
    this.outputChannel = vscode.window.createOutputChannel("SimplicityHL Compiler");
  }

  // Compile a .simf file with optional witness and flags
  public async compileFile(
    filePath: string,
    options: CompileOptions = {}
  ): Promise<CompileResult> {
    this.outputChannel.clear();
    this.outputChannel.show(true);
    let simcPath: string;
    try {
      simcPath = getSimcPath();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`Unable to prepare compilation: ${message}`);
      return { success: false, error: message };
    }
    const args = compilerArguments(
      filePath,
      getExperimentalFeatures(),
      options,
    );

    // Show compilation info in output channel
    this.outputChannel.appendLine(`Compiling: ${filePath}`);
    this.outputChannel.appendLine(
      `Command: ${[simcPath, ...args].map(shellDisplay).join(" ")}`,
    );
    this.outputChannel.appendLine("");

    return new Promise((resolve) => {
      const proc = cp.spawn(simcPath, args, {
        cwd: path.dirname(filePath),
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
        this.outputChannel.append(data.toString());
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
        this.outputChannel.append(data.toString());
      });

      proc.on("close", (code) => {
        if (code === 0) {
          this.outputChannel.appendLine("\nCompilation successful!");
          const { program, witness } = parseCompilerOutput(stdout, Boolean(options.json));

          resolve({
            success: true,
            program,
            witness,
          });
        } else {
          this.outputChannel.appendLine(`\nCompilation failed with exit code ${code}`);
          resolve({
            success: false,
            error: stderr || stdout,
          });
        }
      });

      proc.on("error", (err) => {
        this.outputChannel.appendLine(`\nFailed to start compiler: ${err.message}`);
        resolve({
          success: false,
          error: err.message,
        });
      });
    });
  }

  // Clean up resources
  public dispose(): void {
    this.outputChannel.dispose();
  }
}

function shellDisplay(argument: string): string {
  return /[\s"']/u.test(argument) ? JSON.stringify(argument) : argument;
}

// Singleton instance for extension lifetime
let compiler: SimplicityHLCompiler | undefined;

export function getCompiler(): SimplicityHLCompiler {
  if (!compiler) {
    compiler = new SimplicityHLCompiler();
  }
  return compiler;
}

export function disposeCompiler(): void {
  compiler?.dispose();
  compiler = undefined;
}

// Locate the simc compiler binary
export function getSimcPath(): string {
  // Check user-configured path first
  const config = vscode.workspace.getConfiguration("simplicityhl");
  const configuredPath = config.get<string>("compiler.path");
  if (configuredPath && configuredPath.trim()) {
    return configuredPath;
  }

  // Search in PATH and common locations
  const simcPath = findExecutable("simc");
  if (simcPath) {
    return simcPath;
  }

  throw new Error(
    "simc compiler not found. See https://github.com/BlockstreamResearch/SimplicityHL#installation " +
    "or set simplicityhl.compiler.path in settings."
  );
}
