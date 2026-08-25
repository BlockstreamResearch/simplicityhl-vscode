// LSP client for SimplicityHL language server.
// Manages connection lifecycle and integrates with status bar.

import * as fs from "node:fs";
import process from "node:process";
import {
  ExtensionContext,
  window,
  workspace,
} from "vscode";
import {
  Executable,
  LanguageClient,
  ServerOptions,
} from "vscode-languageclient/node";
import {
  CONFIGURATION_SECTION,
  LANGUAGE_CLIENT_ID,
  LANGUAGE_CLIENT_NAME,
  SERVER_BINARY,
  SETTINGS,
  languageClientOptions,
} from "./contracts";
import { ensureExecutable } from "./find_server";
import { getExperimentalFeatures } from "./settings";
import { getStatusBar } from "./statusBar";

export class LspClient {
  private client: LanguageClient | undefined;

  public constructor(context: ExtensionContext) {
    context.subscriptions.push(
      workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(CONFIGURATION_SECTION)) {
          return;
        }
        if (
          event.affectsConfiguration(
            `${CONFIGURATION_SECTION}.${SETTINGS.serverPath.key}`,
          )
        ) {
          void this.restart();
        }
      }),
    );
  }

  public async start(): Promise<void> {
    const statusBar = getStatusBar();
    statusBar.update("starting");
    statusBar.show();

    const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);
    const configuredPath = configuration
      .get<string>(SETTINGS.serverPath.key, SETTINGS.serverPath.default)
      .trim();
    let execPath: string | null;
    if (configuredPath) {
      if (!fs.existsSync(configuredPath)) {
        statusBar.update("error");
        window.showErrorMessage(
          `Configured SimplicityHL language server does not exist: ${configuredPath}`,
        );
        return;
      }
      execPath = configuredPath;
    } else {
      execPath = await ensureExecutable(SERVER_BINARY);
    }

    if (!execPath) {
      statusBar.update("disconnected");
      return;
    }

    const run: Executable = {
      command: execPath,
      options: {
        env: {
          ...process.env,
        },
      },
    };
    const serverOptions: ServerOptions = {
      run,
      debug: run,
    };

    const clientOptions = languageClientOptions(getExperimentalFeatures());

    this.client = new LanguageClient(
      LANGUAGE_CLIENT_ID,
      LANGUAGE_CLIENT_NAME,
      serverOptions,
      clientOptions,
    );

    try {
      await this.client.start();
      statusBar.update("connected");
      window.showInformationMessage("SimplicityHL Language Server activated!");
    } catch (e) {
      this.client = undefined;
      statusBar.update("error");
      window.showErrorMessage(
        `Failed to start SimplicityHL Language Server: ${e}`,
      );
    }
  }

  public async stop(): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.stop();
    this.client = undefined;
    getStatusBar().update("disconnected");
  }

  public async restart(): Promise<void> {
    const statusBar = getStatusBar();

    if (!this.client) {
      // Try to start even if not previously initialized
      await this.start();
      return;
    }

    try {
      statusBar.update("starting");
      await this.stop();
      await this.start();
      window.showInformationMessage("SimplicityHL Language Server restarted successfully!");
    } catch (e) {
      statusBar.update("error");
      window.showErrorMessage(`Failed to restart LSP: ${e}`);
    }
  }
}
