// Shared executable discovery, Cargo installation, and update checks.

import * as cp from "node:child_process";

import { env, ProgressLocation, Uri, window, workspace } from "vscode";

import { findExecutable } from "../find_executable";
import { CONFIGURATION_SECTION, SETTINGS, ManagedBinary, MANAGED_BINARY_INFO } from "../contracts";
import {
  BinaryUpdateResult,
} from "../update/binary_update_state";

// TODO: move it to cargo/install.ts

interface EnsureExecutableOptions {
  displayName: string;
  disableAutoupdateSetting: { key: string; default: boolean };
  suppressMissingWarningSetting: { key: string; default: boolean };
  update?: (
    executableExists: boolean,
    install: (version?: string) => Promise<void>,
  ) => Promise<BinaryUpdateResult>;
}

async function installCargoExecutable(
  command: ManagedBinary,
  version?: string,
) {
  const cargoPath = findExecutable("cargo");
  if (!cargoPath) {
    throw new Error(
      "Unable to find 'cargo'. Please ensure Rust is installed and in your PATH.",
    );
  }

  const action = findExecutable(command) ? "Updating" : "Installing";

  return window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `${action} ${command}`,
      cancellable: true,
    },
    async (progress, token) => {
      return new Promise<void>((resolve, reject) => {
        const cancellation = new AbortController();
        const packageSpec =
          version === undefined ? command : `${command}@${version}`;
        const installProcess = cp.spawn(
          cargoPath,
          ["install", "--color", "never", packageSpec],
          { shell: false, signal: cancellation.signal },
        );
        let settled = false;
        const progressCancellation = token.onCancellationRequested(() => {
          cancellation.abort();
        });
        const finish = (error?: Error): void => {
          if (settled) {
            return;
          }
          settled = true;
          progressCancellation.dispose();
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };

        const reportProgress = (data: Buffer) => {
          const lines = data
            .toString()
            .split(/\r?\n/)
            .map((l) => l.trim());

          for (const line of lines) {
            if (line.startsWith("Compiling") && line !== "Compiling") {
              progress.report({ message: line });
            }
          }
        };

        installProcess.stderr?.on("data", reportProgress);

        installProcess.on("close", (code) => {
          if (cancellation.signal.aborted) {
            finish(new Error("Installation canceled"));
            return;
          }
          if (code === 0) {
            finish();
          } else {
            finish(new Error(`Installation failed with exit code ${code}`));
          }
        });

        installProcess.on("error", (err) => {
          if (!cancellation.signal.aborted) {
            finish(new Error(`Failed to start cargo process: ${err.message}`));
          }
        });

        if (token.isCancellationRequested) {
          cancellation.abort();
        }
      });
    },
  );
}

export async function ensureExecutableInner(
  command: ManagedBinary,
  options: EnsureExecutableOptions,
): Promise<string | null> {
  const cargoPath = findExecutable("cargo");
  const config = workspace.getConfiguration(CONFIGURATION_SECTION);

  let executablePath = findExecutable(command);

  if (!cargoPath && !executablePath) {
    const suppressWarning = config.get<boolean>(
      options.suppressMissingWarningSetting.key,
      options.suppressMissingWarningSetting.default,
    );
    if (suppressWarning) {
      return null;
    }

    const choice = await window.showWarningMessage(
      `To use ${options.displayName}, please install cargo`,
      "Learn more",
      "Don't show again",
    );

    if (choice === "Learn more") {
      const url = "https://rust-lang.org/tools/install";
      await env.openExternal(Uri.parse(url));
    } else if (choice === "Don't show again") {
      await config.update(
        options.suppressMissingWarningSetting.key,
        true,
        true,
      );
    }

    return null;
  }

  if (!cargoPath) {
    return executablePath;
  }

  const disableAutoupdate = config.get<boolean>(
    options.disableAutoupdateSetting.key,
    options.disableAutoupdateSetting.default,
  );

  if (executablePath && disableAutoupdate) {
    return executablePath;
  }

  try {
    if (options.update && (!disableAutoupdate || !executablePath)) {
      const result = await options.update(executablePath !== null, (version) =>
        installCargoExecutable(command, version),
      );
      if (result === BinaryUpdateResult.Executed) {
        executablePath = findExecutable(command);
      }
      // A consumed event must never prevent installing a missing executable.
      if (executablePath) {
        return executablePath;
      }
    }

    await installCargoExecutable(command);

    executablePath = findExecutable(command);
  } catch (err) {
    window.showErrorMessage(err);
    // A failed optional update must not hide the executable that was already available
    if (options.update && executablePath) {
      return executablePath;
    }
    return null;
  }

  return executablePath;
}

// Language-server installation policy; Cargo process handling is shared.

export function ensureExecutable(
  command: ManagedBinary,
): Promise<string | null> {
  return ensureExecutableInner(command, {
    displayName: MANAGED_BINARY_INFO[command].displayName,
    disableAutoupdateSetting: SETTINGS.disableAutoupdate,
    suppressMissingWarningSetting: SETTINGS.suppressMissingLspWarning,
  });
}
