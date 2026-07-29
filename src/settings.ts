import * as vscode from "vscode";

import type { ExperimentalFeatures } from "./features";

export function getExperimentalFeatures(): ExperimentalFeatures {
  const configuration = vscode.workspace.getConfiguration("simplicityhl");
  return {
    imports: configuration.get<boolean>("experimentalFeatures.imports", false),
    enums: configuration.get<boolean>("experimentalFeatures.enums", false),
  };
}

export function lspInitializationOptions(): object {
  return {
    simplicityhl: {
      experimentalFeatures: getExperimentalFeatures(),
    },
  };
}
