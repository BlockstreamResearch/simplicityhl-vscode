import * as cp from "node:child_process";

import { env, ProgressLocation, Uri, window, workspace } from "vscode";

import { CONFIGURATION_SECTION, SETTINGS } from "../contracts";
import { findExecutable } from "../find_executable";

async function installServer(command: string) {
  const cargoPath = findExecutable("cargo");
  if (!cargoPath) {
    throw new Error("Unable to find 'cargo'. Please ensure Rust is installed and in your PATH.");
  }

  const action = findExecutable(command) ? "Updating" : "Installing";

  return window.withProgress({
    location: ProgressLocation.Notification,
    title: `${action} ${command}`,
    cancellable: true
  }, async (progress, token) => {
    return new Promise<void>((resolve, reject) => {
      const cancellation = new AbortController();
      const installProcess = cp.spawn(
        cargoPath,
        ["install", "--color", "never", command],
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
        const lines = data.toString()
          .split(/\r?\n/)
          .map(l => l.trim())

        for (const line of lines) {
          if (line.startsWith("Compiling") && line !== "Compiling") {
            progress.report({ message: line });
          }
        }
      };

      installProcess.stderr?.on('data', reportProgress);

      installProcess.on('close', (code) => {
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

      installProcess.on('error', (err) => {
        if (!cancellation.signal.aborted) {
          finish(new Error(`Failed to start cargo process: ${err.message}`));
        }
      });

      if (token.isCancellationRequested) {
        cancellation.abort();
      }
    });
  });
}

export async function ensureExecutable(
  command: string,
): Promise<string | null> {
  const cargoPath = findExecutable("cargo");
  const config = workspace.getConfiguration(CONFIGURATION_SECTION);

  let serverPath = findExecutable(command);

  if (!cargoPath && !serverPath) {
    const suppressWarning = config.get<boolean>(
      SETTINGS.suppressMissingLspWarning.key,
      SETTINGS.suppressMissingLspWarning.default,
    );
    if (suppressWarning) {
      return null;
    }

    const choice = await window.showWarningMessage(
      `To use SimplicityHL language server, please install cargo`,
      "Learn more",
      "Don't show again",
    );

    if (choice === "Learn more") {
      const url = "https://rust-lang.org/tools/install";
      await env.openExternal(Uri.parse(url));
    } else if (choice === "Don't show again") {
      await config.update(
        SETTINGS.suppressMissingLspWarning.key,
        true,
        true,
      );
    }

    return null;
  }

  if (!cargoPath) {
    return serverPath;
  }

  const disableAutoupdate = config.get<boolean>(
    SETTINGS.disableAutoupdate.key,
    SETTINGS.disableAutoupdate.default,
  );

  if (serverPath && disableAutoupdate) {
    return serverPath;
  }

  try {
    await installServer(command);

    serverPath = findExecutable(command);
  } catch (err) {
    window.showErrorMessage(err);
    return null;
  }

  return serverPath;
}
