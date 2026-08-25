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
} from "../contracts";
import { ensureExecutable } from "../find_server";
import { getExperimentalFeatures } from "../settings";
import { getStatusBar } from "./status";

export class LspClient {
  private client: LanguageClient | undefined;
  private lifecycle: Promise<void> = Promise.resolve();
  private lifecycleRequest = 0;

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

  public start(): Promise<void> {
    const request = ++this.lifecycleRequest;
    return this.serialize(() => this.startNow(request));
  }

  private async startNow(request: number): Promise<void> {
    if (!this.isCurrent(request) || this.client) {
      return;
    }
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

    if (!this.isCurrent(request)) {
      return;
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
      if (!this.isCurrent(request)) {
        await this.stopNow();
        return;
      }
      statusBar.update("connected");
      window.showInformationMessage("SimplicityHL Language Server activated!");
    } catch (e) {
      this.client = undefined;
      if (!this.isCurrent(request)) {
        return;
      }
      statusBar.update("error");
      window.showErrorMessage(
        `Failed to start SimplicityHL Language Server: ${e}`,
      );
    }
  }

  public stop(): Promise<void> {
    ++this.lifecycleRequest;
    return this.serialize(() => this.stopNow());
  }

  private async stopNow(): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      await client.stop();
    } finally {
      if (this.client === client) {
        this.client = undefined;
      }
      getStatusBar().update("disconnected");
    }
  }

  public restart(): Promise<void> {
    const request = ++this.lifecycleRequest;
    return this.serialize(() => this.restartNow(request));
  }

  private async restartNow(request: number): Promise<void> {
    if (!this.isCurrent(request)) {
      return;
    }
    const statusBar = getStatusBar();

    if (!this.client) {
      // Try to start even if not previously initialized
      await this.startNow(request);
      return;
    }

    try {
      statusBar.update("starting");
      await this.stopNow();
      if (!this.isCurrent(request)) {
        return;
      }
      await this.startNow(request);
      if (this.isCurrent(request) && this.client) {
        window.showInformationMessage("SimplicityHL Language Server restarted successfully!");
      }
    } catch (e) {
      if (!this.isCurrent(request)) {
        return;
      }
      statusBar.update("error");
      window.showErrorMessage(`Failed to restart LSP: ${e}`);
    }
  }

  private isCurrent(request: number): boolean {
    return request === this.lifecycleRequest;
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.lifecycle.then(operation, operation);
    this.lifecycle = result.catch(() => undefined);
    return result;
  }
}
