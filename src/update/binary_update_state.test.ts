import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { Memento } from "vscode";

import { ManagedBinary } from "../contracts";
import {
  BinaryUpdateEventState,
  BinaryUpdateResult,
  UpdateEventStatus,
} from "./binary_update_state";

const KEY = "simplicityhl.binaryUpdateState.v1";

function createFixture(initialValue?: unknown) {
  const values = new Map<string, unknown>();
  if (initialValue !== undefined) values.set(KEY, initialValue);
  const state: Pick<Memento, "get" | "update"> = {
    get<T>(key: string, defaultValue?: T): T {
      return values.has(key) ? (values.get(key) as T) : (defaultValue as T);
    },
    async update(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  };
  return { values, state, tracker: new BinaryUpdateEventState(state) };
}

void test("validates persisted state and safely ignores malformed records and metadata", () => {
  const { tracker } = createFixture({
    [ManagedBinary.Simfmt]: {
      event: UpdateEventStatus.Pending,
      lastSuccessfulUpdate: { at: 123, version: "0.2.0", ignored: true },
      ignored: true,
    },
    [ManagedBinary.LanguageServer]: {
      event: UpdateEventStatus.Consumed,
      lastSuccessfulUpdate: { at: "not a timestamp", version: 42 },
    },
    unknown: { event: UpdateEventStatus.Pending },
    malformed: "record",
  });

  assert.deepEqual(tracker.getRecord(ManagedBinary.Simfmt), {
    event: UpdateEventStatus.Pending,
    lastSuccessfulUpdate: { at: 123, version: "0.2.0" },
  });
  assert.deepEqual(tracker.getRecord(ManagedBinary.LanguageServer), {
    event: UpdateEventStatus.Consumed,
  });
});

void test("markPending persists the event and preserves valid success metadata", async () => {
  const { tracker, values } = createFixture({
    [ManagedBinary.Simfmt]: {
      event: UpdateEventStatus.Consumed,
      lastSuccessfulUpdate: { at: 456, version: "1.0.0" },
    },
  });

  await tracker.markPending(ManagedBinary.Simfmt);
  assert.deepEqual(tracker.getRecord(ManagedBinary.Simfmt), {
    event: UpdateEventStatus.Pending,
    lastSuccessfulUpdate: { at: 456, version: "1.0.0" },
  });
  assert.deepEqual(values.get(KEY), {
    [ManagedBinary.Simfmt]: {
      event: UpdateEventStatus.Pending,
      lastSuccessfulUpdate: { at: 456, version: "1.0.0" },
    },
  });
});

void test("persistence failures retain in-memory state and do not block operations", async (t) => {
  const failure = new Error("storage unavailable");
  const { tracker, state } = createFixture();
  state.update = async () => {
    throw failure;
  };
  const warn = t.mock.method(console, "warn", () => {});

  await tracker.markPending(ManagedBinary.Simfmt);
  assert.deepEqual(tracker.getRecord(ManagedBinary.Simfmt), {
    event: UpdateEventStatus.Pending,
  });

  let invoked = false;
  assert.equal(
    await tracker.runIfPending(ManagedBinary.Simfmt, () => {
      invoked = true;
    }),
    BinaryUpdateResult.Executed,
  );
  assert.equal(invoked, true);
  assert.equal(warn.mock.callCount(), 2);
  assert.equal(warn.mock.calls[0].arguments[1], failure);
});

void test("runIfPending skips non-pending events and consumes before invoking operation", async () => {
  const { tracker, state, values } = createFixture({
    [ManagedBinary.Simfmt]: { event: UpdateEventStatus.Pending },
  });
  let invoked = false;
  const result = await tracker.runIfPending(ManagedBinary.Simfmt, () => {
    invoked = true;
    assert.deepEqual(values.get(KEY), {
      [ManagedBinary.Simfmt]: { event: UpdateEventStatus.Consumed },
    });
  });

  assert.equal(result, BinaryUpdateResult.Executed);
  assert.equal(invoked, true);
  assert.deepEqual(tracker.getRecord(ManagedBinary.Simfmt), {
    event: UpdateEventStatus.Consumed,
  });
  assert.equal(
    await tracker.runIfPending(ManagedBinary.Simfmt, () => {}),
    BinaryUpdateResult.Skipped,
  );
  assert.notEqual(state, undefined);
});

void test("runIfPending keeps consumed status when operation fails", async () => {
  const { tracker } = createFixture({
    [ManagedBinary.LanguageServer]: { event: UpdateEventStatus.Pending },
  });
  const failure = new Error("update failed");

  await assert.rejects(
    tracker.runIfPending(ManagedBinary.LanguageServer, () => {
      throw failure;
    }),
    failure,
  );
  assert.deepEqual(tracker.getRecord(ManagedBinary.LanguageServer), {
    event: UpdateEventStatus.Consumed,
  });
  assert.equal(
    await tracker.runIfPending(ManagedBinary.LanguageServer, () => {}),
    BinaryUpdateResult.Skipped,
  );
});

void test("concurrent calls share one in-flight operation promise per binary", async () => {
  const { tracker } = createFixture({
    [ManagedBinary.Simfmt]: { event: UpdateEventStatus.Pending },
  });
  let invoked = 0;
  let release!: () => void;
  const operationDone = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operation = async () => {
    invoked += 1;
    await operationDone;
  };

  const first = tracker.runIfPending(ManagedBinary.Simfmt, operation);
  const second = tracker.runIfPending(ManagedBinary.Simfmt, () => {});
  assert.strictEqual(second, first);
  assert.equal(invoked, 0);
  release();
  assert.equal(await first, BinaryUpdateResult.Executed);
  assert.equal(await second, BinaryUpdateResult.Executed);
  assert.equal(invoked, 1);
});

void test("serializes pending and consumed writes triggered during activation", async () => {
  const values = new Map<string, unknown>();
  const writes: unknown[] = [];
  let releaseFirstWrite!: () => void;
  const firstWrite = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const state: Pick<Memento, "get" | "update"> = {
    get<T>(_key: string, defaultValue?: T): T {
      return defaultValue as T;
    },
    async update(key: string, value: unknown): Promise<void> {
      writes.push(value);
      if (writes.length === 1) await firstWrite;
      values.set(key, value);
    },
  };
  const tracker = new BinaryUpdateEventState(state);

  const pendingWrite = tracker.markPending(ManagedBinary.Simfmt);
  const operation = tracker.runIfPending(ManagedBinary.Simfmt, () => {});
  assert.equal(writes.length, 0);

  await Promise.resolve();
  assert.equal(writes.length, 1);
  releaseFirstWrite();
  await pendingWrite;
  assert.equal(await operation, BinaryUpdateResult.Executed);
  assert.deepEqual(writes, [
    { [ManagedBinary.Simfmt]: { event: UpdateEventStatus.Pending } },
    { [ManagedBinary.Simfmt]: { event: UpdateEventStatus.Consumed } },
  ]);
  assert.deepEqual(values.get(KEY), {
    [ManagedBinary.Simfmt]: { event: UpdateEventStatus.Consumed },
  });
});

void test("recordSuccessfulUpdate persists timestamp and optional version", async () => {
  const { tracker, values } = createFixture({
    [ManagedBinary.Simfmt]: { event: UpdateEventStatus.Consumed },
  });
  await tracker.recordSuccessfulUpdate(ManagedBinary.Simfmt, 789, "2.0.0");
  assert.deepEqual(values.get(KEY), {
    [ManagedBinary.Simfmt]: {
      event: UpdateEventStatus.Consumed,
      lastSuccessfulUpdate: { at: 789, version: "2.0.0" },
    },
  });
});
