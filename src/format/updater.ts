import { ManagedBinary } from "../contracts";
import {
  BinaryUpdateResult,
  type BinaryUpdateEventState,
} from "../update/binary_update_state";
import { getCrateVersion } from "../update/crates_io";
import type { CrateVersion } from "../update/crates_io";

export type SimfmtVersionLookup = () => Promise<CrateVersion>;
export type SimfmtInstall = (version?: CrateVersion) => Promise<void>;

/** Coordinates one startup simfmt update event with crates.io and installation. */
export class SimfmtUpdater {
  public constructor(
    private readonly state: BinaryUpdateEventState,
    private readonly getVersion: SimfmtVersionLookup = () => getCrateVersion(ManagedBinary.Simfmt),
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Consume the pending simfmt event and update when the installed binary is
   * absent or does not match the current crates.io default version.
   */
  public run(executableExists: boolean, install: SimfmtInstall): Promise<BinaryUpdateResult> {
    return this.state.runIfPending(ManagedBinary.Simfmt, async () => {
      const previousVersion = this.state.getRecord(ManagedBinary.Simfmt)?.lastSuccessfulUpdate?.version;

      let version: CrateVersion;
      try {
        version = await this.getVersion();
      } catch (error) {
        if (executableExists) {
          console.warn("Unable to determine the latest simfmt version; keeping the existing executable.", error);
          return;
        }

        await install();
        await this.state.recordSuccessfulUpdate(ManagedBinary.Simfmt, this.now());
        return;
      }

      if (executableExists && previousVersion === version) return;

      await install(version);
      await this.state.recordSuccessfulUpdate(ManagedBinary.Simfmt, this.now(), version);
    });
  }
}
