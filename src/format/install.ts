// Formatter executable resolution and automatic-update policy.

import { workspace } from "vscode";
import {CONFIGURATION_SECTION, SETTINGS, ManagedBinary, MANAGED_BINARY_INFO} from "../contracts";
import { ensureExecutableInner } from "../lsp/install";
import {
  type BinaryUpdateEventState,
} from "../update/binary_update_state";
import { SimfmtUpdater } from "./updater";

export async function getSimfmtPath(updateState: BinaryUpdateEventState): Promise<string> {
  const config = workspace.getConfiguration(CONFIGURATION_SECTION);
  const configuredPath = config.get<string>(
    SETTINGS.formatterPath.key,
    SETTINGS.formatterPath.default,
  ).trim();
  if (configuredPath) {
    return configuredPath;
  }

  const updater = new SimfmtUpdater(updateState);
  const command = ManagedBinary.Simfmt;
  const formatterPath = await ensureExecutableInner(command, {
    displayName: MANAGED_BINARY_INFO[command].displayName,
    disableAutoupdateSetting: SETTINGS.formatterDisableAutoupdate,
    suppressMissingWarningSetting: SETTINGS.suppressMissingFormatterWarning,
    update: (executableExists, install) => updater.run(executableExists, install),
  });
  if (formatterPath) {
    return formatterPath;
  }

  throw new Error(
    "simfmt formatter not found. Install simfmt and add it to PATH, " +
    `or set ${CONFIGURATION_SECTION}.${SETTINGS.formatterPath.key}.`,
  );
}
