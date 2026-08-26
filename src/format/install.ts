// Formatter executable resolution and automatic-update policy.

import { workspace } from "vscode";
import { CONFIGURATION_SECTION, FORMATTER_BINARY, SETTINGS } from "../contracts";
import { ensureExecutable } from "../install_executable";
import type { UpdateCache } from "../update_cache";

export async function getSimfmtPath(updateCache: UpdateCache): Promise<string> {
  const config = workspace.getConfiguration(CONFIGURATION_SECTION);
  const configuredPath = config.get<string>(
    SETTINGS.formatterPath.key,
    SETTINGS.formatterPath.default,
  ).trim();
  if (configuredPath) {
    return configuredPath;
  }

  const formatterPath = await ensureExecutable(FORMATTER_BINARY, {
    displayName: "SimplicityHL formatter",
    disableAutoupdateSetting: SETTINGS.formatterDisableAutoupdate,
    updateCache,
  });
  if (formatterPath) {
    return formatterPath;
  }

  throw new Error(
    "simfmt formatter not found. Install simfmt and add it to PATH, " +
    `or set ${CONFIGURATION_SECTION}.${SETTINGS.formatterPath.key}.`,
  );
}
