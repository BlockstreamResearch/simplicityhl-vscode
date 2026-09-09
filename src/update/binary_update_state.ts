import type { Memento } from "vscode";
import { ManagedBinary } from "../contracts";

export enum UpdateEventStatus {
  Pending = "pending",
  Consumed = "consumed",
}

export enum BinaryUpdateResult {
  Skipped = "skipped",
  Executed = "executed",
}

export interface SuccessfulUpdate {
  at: number;
  version?: string;
}

export interface BinaryUpdateRecord {
  event: UpdateEventStatus;
  lastSuccessfulUpdate?: SuccessfulUpdate;
}

/** The shape stored under the module's versioned Memento key. */
export type BinaryUpdateState = Partial<
  Record<ManagedBinary, BinaryUpdateRecord>
>;

// Keep the key private so consumers cannot accidentally couple themselves to the
// persistence format. Bumping the key version permits a future format migration.
export const STATE_KEY = "simplicityhl.binaryUpdateState.v1";

type UnknownRecord = Record<string, unknown>;

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManagedBinary(value: unknown): value is ManagedBinary {
  return (
    value === ManagedBinary.Simfmt || value === ManagedBinary.LanguageServer
  );
}

function isEventStatus(value: unknown): value is UpdateEventStatus {
  return (
    value === UpdateEventStatus.Pending || value === UpdateEventStatus.Consumed
  );
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function cloneSuccessfulUpdate(value: SuccessfulUpdate): SuccessfulUpdate {
  return value.version === undefined
    ? { at: value.at }
    : { at: value.at, version: value.version };
}

function cloneRecord(value: BinaryUpdateRecord): BinaryUpdateRecord {
  return value.lastSuccessfulUpdate === undefined
    ? { event: value.event }
    : {
        event: value.event,
        lastSuccessfulUpdate: cloneSuccessfulUpdate(value.lastSuccessfulUpdate),
      };
}

function parseSuccessfulUpdate(value: unknown): SuccessfulUpdate | undefined {
  if (!isObject(value) || !hasOwn(value, "at") || !isValidTimestamp(value.at))
    return undefined;
  const version = hasOwn(value, "version") ? value.version : undefined;
  if (version === undefined) return { at: value.at };
  if (typeof version !== "string" || version.length === 0) return undefined;
  return { at: value.at, version };
}

function parseRecord(value: unknown): BinaryUpdateRecord | undefined {
  if (
    !isObject(value) ||
    !hasOwn(value, "event") ||
    !isEventStatus(value.event)
  )
    return undefined;

  // A malformed metadata object is discarded, while its valid event is retained.
  const metadata =
    !hasOwn(value, "lastSuccessfulUpdate") ||
    value.lastSuccessfulUpdate === undefined
      ? undefined
      : parseSuccessfulUpdate(value.lastSuccessfulUpdate);
  return metadata === undefined
    ? { event: value.event }
    : { event: value.event, lastSuccessfulUpdate: metadata };
}

function parseState(value: unknown): Map<ManagedBinary, BinaryUpdateRecord> {
  const records = new Map<ManagedBinary, BinaryUpdateRecord>();
  if (!isObject(value)) return records;

  for (const binary of Object.values(ManagedBinary)) {
    if (!Object.prototype.hasOwnProperty.call(value, binary)) continue;
    const record = parseRecord(value[binary]);
    if (record !== undefined) records.set(binary, record);
  }
  return records;
}

function serializeState(
  records: Map<ManagedBinary, BinaryUpdateRecord>,
): BinaryUpdateState {
  const state: BinaryUpdateState = {};
  for (const [binary, record] of records) state[binary] = cloneRecord(record);
  return state;
}

export class BinaryUpdateEventState {
  private readonly records: Map<ManagedBinary, BinaryUpdateRecord>;
  private readonly inFlight = new Map<
    ManagedBinary,
    Promise<BinaryUpdateResult>
  >();
  private persistence = Promise.resolve();

  public constructor(private readonly state: Pick<Memento, "get" | "update">) {
    this.records = parseState(this.state.get<unknown>(STATE_KEY));
  }

  /** Mark an update event pending, retaining any valid success metadata. */
  public async markPending(binary: ManagedBinary): Promise<void> {
    this.assertBinary(binary);
    const existing = this.records.get(binary);
    this.records.set(binary, {
      event: UpdateEventStatus.Pending,
      ...(existing?.lastSuccessfulUpdate === undefined
        ? {}
        : {
            lastSuccessfulUpdate: cloneSuccessfulUpdate(
              existing.lastSuccessfulUpdate,
            ),
          }),
    });
    await this.persist();
  }

  /**
   * Consume and execute a pending event exactly once per in-flight attempt.
   * Consumption is persisted before the operation starts and is retained when
   * the operation rejects.
   */
  public runIfPending(
    binary: ManagedBinary,
    operation: () => void | PromiseLike<void>,
  ): Promise<BinaryUpdateResult> {
    this.assertBinary(binary);

    const current = this.inFlight.get(binary);
    if (current !== undefined) return current;
    if (this.records.get(binary)?.event !== UpdateEventStatus.Pending) {
      return Promise.resolve(BinaryUpdateResult.Skipped);
    }

    const attempt = this.consumeAndRun(binary, operation);
    this.inFlight.set(binary, attempt);
    void attempt.then(
      () => this.clearInFlight(binary, attempt),
      () => this.clearInFlight(binary, attempt),
    );
    return attempt;
  }

  /** Record the timestamp and optional version of a successful update. */
  public async recordSuccessfulUpdate(
    binary: ManagedBinary,
    at: number,
    version?: string,
  ): Promise<void> {
    this.assertBinary(binary);
    if (!isValidTimestamp(at))
      throw new RangeError(
        "Successful update time must be a finite non-negative number.",
      );
    if (
      version !== undefined &&
      (typeof version !== "string" || version.length === 0)
    ) {
      throw new TypeError(
        "Successful update version must be a non-empty string when provided.",
      );
    }

    const existing = this.records.get(binary);
    const lastSuccessfulUpdate: SuccessfulUpdate =
      version === undefined ? { at } : { at, version };
    this.records.set(binary, {
      event: existing?.event ?? UpdateEventStatus.Consumed,
      lastSuccessfulUpdate,
    });
    await this.persist();
  }

  /** Return a defensive copy of a binary's current in-memory record. */
  public getRecord(binary: ManagedBinary): BinaryUpdateRecord | undefined {
    this.assertBinary(binary);
    const record = this.records.get(binary);
    return record === undefined ? undefined : cloneRecord(record);
  }

  private async consumeAndRun(
    binary: ManagedBinary,
    operation: () => void | PromiseLike<void>,
  ): Promise<BinaryUpdateResult> {
    const existing = this.records.get(binary);
    this.records.set(binary, {
      event: UpdateEventStatus.Consumed,
      ...(existing?.lastSuccessfulUpdate === undefined
        ? {}
        : {
            lastSuccessfulUpdate: cloneSuccessfulUpdate(
              existing.lastSuccessfulUpdate,
            ),
          }),
    });
    await this.persist();
    await operation();
    return BinaryUpdateResult.Executed;
  }

  private clearInFlight(
    binary: ManagedBinary,
    attempt: Promise<BinaryUpdateResult>,
  ): void {
    if (this.inFlight.get(binary) === attempt) this.inFlight.delete(binary);
  }

  private async persist(): Promise<void> {
    const snapshot = serializeState(this.records);
    this.persistence = this.persistence.then(async () => {
      try {
        await this.state.update(STATE_KEY, snapshot);
      } catch (error) {
        console.warn(
          "Unable to persist binary update state; using session state.",
          error,
        );
      }
    });
    await this.persistence;
  }

  private assertBinary(binary: ManagedBinary): void {
    if (!isManagedBinary(binary))
      throw new TypeError(`Unknown managed binary: ${String(binary)}`);
  }
}
