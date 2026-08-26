import type { Memento } from "vscode";

const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateCache {
  /**
   * Returning true reserves the update attempt before resolving, even if the
   * update later fails or is canceled. Returning false leaves the cache unchanged.
   */
  shouldUpdate(): Promise<boolean>;
}

export class DailyUpdateCache implements UpdateCache {
  private lastAttemptAt: number | undefined;

  public constructor(
    private readonly state: Pick<Memento, "get" | "update">,
    private readonly key: string,
    private readonly now: () => number = Date.now,
  ) {}

  public async shouldUpdate(): Promise<boolean> {
    const now = this.now();
    const previousAttempts = [this.lastAttemptAt, this.state.get<unknown>(this.key)];
    const recentlyAttempted = previousAttempts.some((timestamp) =>
      typeof timestamp === "number" &&
      Number.isFinite(timestamp) &&
      timestamp >= 0 &&
      timestamp <= now &&
      now - timestamp < UPDATE_INTERVAL_MS,
    );

    if (recentlyAttempted) {
      return false;
    }

    // Reserve synchronously so concurrent calls and failed writes stay throttled.
    this.lastAttemptAt = now;
    try {
      await this.state.update(this.key, now);
    } catch (error) {
      console.warn(`Unable to persist update cache '${this.key}'; using session state.`, error);
    }

    return true;
  }
}
