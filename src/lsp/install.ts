// Language-server installation policy; Cargo process handling is shared.

import { SETTINGS } from "../contracts";
import { ensureExecutable as ensureInstalledExecutable } from "../install_executable";

export function ensureExecutable(command: string): Promise<string | null> {
  return ensureInstalledExecutable(command, {
    displayName: "SimplicityHL language server",
    disableAutoupdateSetting: SETTINGS.disableAutoupdate,
  });
}
