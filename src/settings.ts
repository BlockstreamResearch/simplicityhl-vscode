import * as vscode from "vscode";

import {
  CONFIGURATION_SECTION,
  SETTINGS,
  type ExperimentalFeatures,
} from "./contracts";

export function getExperimentalFeatures(): ExperimentalFeatures {
  const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  return {
    imports: configuration.get<boolean>(SETTINGS.imports.key, SETTINGS.imports.default),
    enums: configuration.get<boolean>(SETTINGS.enums.key, SETTINGS.enums.default),
  };
}
