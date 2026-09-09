import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ManagedBinary } from "../contracts";
import {
  BinaryUpdateEventState,
  BinaryUpdateResult,
  UpdateEventStatus,
  STATE_KEY,
} from "../update/binary_update_state";
import type { CrateVersion } from "../update/crates_io";
import { SimfmtUpdater } from "./updater";

const NOW = 1_750_000_000_000;

function version(value: string): CrateVersion {
  return value as CrateVersion;
}

function createFixture(record: unknown = { event: UpdateEventStatus.Pending }) {
  const values = new Map<string, unknown>([
    [STATE_KEY, { [ManagedBinary.Simfmt]: record }],
  ]);
  const state = {
    get<T>(_key: string, defaultValue?: T): T {
      return values.has(STATE_KEY) ? values.get(STATE_KEY) as T : defaultValue as T;
    },
    async update(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  };
  const updateState = new BinaryUpdateEventState(state);
  const installs: Array<CrateVersion | undefined> = [];
  const install = async (requestedVersion?: CrateVersion): Promise<void> => {
    installs.push(requestedVersion);
  };
  return { values, updateState, installs, install };
}

void test("does not look up or install when simfmt has no pending event", async () => {
  const { updateState, installs, install } = createFixture({ event: UpdateEventStatus.Consumed });
  let lookups = 0;
  const updater = new SimfmtUpdater(updateState, async () => {
    lookups += 1;
    return version("1.2.3");
  });

  assert.equal(await updater.run(false, install), BinaryUpdateResult.Skipped);
  assert.equal(lookups, 0);
  assert.deepEqual(installs, []);
});

void test("consumes without installing when an existing executable has the fetched version", async () => {
  const { updateState, installs, install } = createFixture({
    event: UpdateEventStatus.Pending,
    lastSuccessfulUpdate: { at: NOW - 100, version: "1.2.3" },
  });
  let lookups = 0;
  const updater = new SimfmtUpdater(updateState, async () => {
    lookups += 1;
    return version("1.2.3");
  });

  assert.equal(await updater.run(true, install), BinaryUpdateResult.Executed);
  assert.equal(lookups, 1);
  assert.deepEqual(installs, []);
  assert.deepEqual(updateState.getRecord(ManagedBinary.Simfmt), {
    event: UpdateEventStatus.Consumed,
    lastSuccessfulUpdate: { at: NOW - 100, version: "1.2.3" },
  });
});

void test("installs the exact fetched version for a missing or outdated executable", async (t) => {
  await t.test("missing executable", async () => {
    const { updateState, installs, install } = createFixture();
    const updater = new SimfmtUpdater(updateState, async () => version("2.0.0"), () => NOW);

    assert.equal(await updater.run(false, install), BinaryUpdateResult.Executed);
    assert.deepEqual(installs, [version("2.0.0")]);
    assert.deepEqual(updateState.getRecord(ManagedBinary.Simfmt), {
      event: UpdateEventStatus.Consumed,
      lastSuccessfulUpdate: { at: NOW, version: "2.0.0" },
    });
  });

  await t.test("different version", async () => {
    const { updateState, installs, install } = createFixture({
      event: UpdateEventStatus.Pending,
      lastSuccessfulUpdate: { at: NOW - 100, version: "1.0.0" },
    });
    const updater = new SimfmtUpdater(updateState, async () => version("2.0.0"), () => NOW);

    assert.equal(await updater.run(true, install), BinaryUpdateResult.Executed);
    assert.deepEqual(installs, [version("2.0.0")]);
    assert.deepEqual(updateState.getRecord(ManagedBinary.Simfmt)?.lastSuccessfulUpdate, {
      at: NOW,
      version: "2.0.0",
    });
  });
});

void test("installs and records a fetched version when previous metadata has no version", async () => {
  const { updateState, installs, install } = createFixture({
    event: UpdateEventStatus.Pending,
    lastSuccessfulUpdate: { at: NOW - 100 },
  });
  const updater = new SimfmtUpdater(updateState, async () => version("3.0.0"), () => NOW);

  assert.equal(await updater.run(true, install), BinaryUpdateResult.Executed);
  assert.deepEqual(installs, [version("3.0.0")]);
  assert.deepEqual(updateState.getRecord(ManagedBinary.Simfmt)?.lastSuccessfulUpdate, {
    at: NOW,
    version: "3.0.0",
  });
});

void test("keeps an existing executable and prior metadata when version lookup fails", async (t) => {
  const { updateState, installs, install } = createFixture({
    event: UpdateEventStatus.Pending,
    lastSuccessfulUpdate: { at: NOW - 100, version: "1.0.0" },
  });
  const failure = new Error("network unavailable");
  const warn = t.mock.method(console, "warn", () => {});
  const updater = new SimfmtUpdater(updateState, async () => { throw failure; }, () => NOW);

  assert.equal(await updater.run(true, install), BinaryUpdateResult.Executed);
  assert.deepEqual(installs, []);
  assert.deepEqual(updateState.getRecord(ManagedBinary.Simfmt), {
    event: UpdateEventStatus.Consumed,
    lastSuccessfulUpdate: { at: NOW - 100, version: "1.0.0" },
  });
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0].arguments[1], failure);
});

void test("falls back to an unversioned install when lookup fails and executable is missing", async () => {
  const { updateState, installs, install } = createFixture();
  const failure = new Error("network unavailable");
  const updater = new SimfmtUpdater(updateState, async () => { throw failure; }, () => NOW);

  assert.equal(await updater.run(false, install), BinaryUpdateResult.Executed);
  assert.deepEqual(installs, [undefined]);
  assert.deepEqual(updateState.getRecord(ManagedBinary.Simfmt), {
    event: UpdateEventStatus.Consumed,
    lastSuccessfulUpdate: { at: NOW },
  });
});

void test("keeps consumed status and prior metadata when installation fails", async () => {
  const { updateState } = createFixture({
    event: UpdateEventStatus.Pending,
    lastSuccessfulUpdate: { at: NOW - 100, version: "1.0.0" },
  });
  const failure = new Error("installation cancelled");
  const updater = new SimfmtUpdater(updateState, async () => version("2.0.0"), () => NOW);

  await assert.rejects(
    updater.run(true, async () => { throw failure; }),
    failure,
  );
  assert.deepEqual(updateState.getRecord(ManagedBinary.Simfmt), {
    event: UpdateEventStatus.Consumed,
    lastSuccessfulUpdate: { at: NOW - 100, version: "1.0.0" },
  });
  assert.equal(await updater.run(true, async () => {}), BinaryUpdateResult.Skipped);
});

void test("shares the activation state's in-flight operation for concurrent calls", async () => {
  const { updateState } = createFixture();
  let lookups = 0;
  let installs = 0;
  let releaseInstall!: () => void;
  const installDone = new Promise<void>((resolve) => { releaseInstall = resolve; });
  const updater = new SimfmtUpdater(updateState, async () => {
    lookups += 1;
    return version("2.0.0");
  });
  const install = async (): Promise<void> => {
    installs += 1;
    await installDone;
  };

  const first = updater.run(false, install);
  const second = updater.run(false, async () => {});
  assert.strictEqual(second, first);
  releaseInstall();
  assert.equal(await first, BinaryUpdateResult.Executed);
  assert.equal(await second, BinaryUpdateResult.Executed);
  assert.equal(lookups, 1);
  assert.equal(installs, 1);
});
