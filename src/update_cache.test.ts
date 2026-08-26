import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { Memento } from "vscode";

import { DailyUpdateCache } from "./update_cache";

const KEY = "test.lastUpdateAttemptAt";
const DAY_MS = 24 * 60 * 60 * 1000;
const START_TIME = 1_750_000_000_000;

function createFixture(initialValue?: unknown) {
  const clock = { now: START_TIME };
  const values = new Map<string, unknown>();
  if (initialValue !== undefined) values.set(KEY, initialValue);

  const state: Pick<Memento, "get" | "update"> = {
    get<T>(key: string, defaultValue?: T): T {
      return values.has(key) ? values.get(key) as T : defaultValue;
    },
    async update(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  };
  const cache = new DailyUpdateCache(state, KEY, () => clock.now);
  return { cache, clock, state, values };
}

void test("persists the first attempt and leaves the timestamp unchanged during cooldown", async (t) => {
  const { cache, clock, state, values } = createFixture();
  const update = t.mock.method(state, "update");

  assert.equal(await cache.shouldUpdate(), true);
  assert.equal(values.get(KEY), clock.now);
  clock.now += 1000;
  assert.equal(await cache.shouldUpdate(), false);
  assert.equal(values.get(KEY), START_TIME);
  assert.equal(update.mock.callCount(), 1);
});

void test("allows the next attempt exactly 24 hours later", async () => {
  const { cache, clock, values } = createFixture();
  assert.equal(await cache.shouldUpdate(), true);

  clock.now += DAY_MS - 1;
  assert.equal(await cache.shouldUpdate(), false);
  clock.now += 1;
  assert.equal(await cache.shouldUpdate(), true);
  assert.equal(values.get(KEY), clock.now);
});

void test("remembers attempts across cache instances and reads newer persisted attempts", async () => {
  const { cache, clock, state } = createFixture();
  assert.equal(await cache.shouldUpdate(), true);

  const reloadedCache = new DailyUpdateCache(state, KEY, () => clock.now);
  assert.equal(await reloadedCache.shouldUpdate(), false);
  clock.now += DAY_MS;
  assert.equal(await reloadedCache.shouldUpdate(), true);
  assert.equal(await cache.shouldUpdate(), false);
});

void test("reserves concurrent attempts before persistence and awaits the write before approval", async (t) => {
  const { cache, state, values } = createFixture();
  let finishWrite: () => void;
  const pendingWrite = new Promise<void>((resolve) => { finishWrite = resolve; });
  const update = t.mock.method(state, "update", async (key, value) => {
    await pendingWrite;
    values.set(key, value);
  });

  let approved = false;
  const firstAttempt = cache.shouldUpdate().then((result) => {
    approved = result;
    return result;
  });
  assert.equal(await cache.shouldUpdate(), false);
  assert.equal(approved, false);
  assert.equal(values.has(KEY), false);

  finishWrite();
  assert.equal(await firstAttempt, true);
  assert.equal(values.get(KEY), START_TIME);
  assert.equal(update.mock.callCount(), 1);
});

void test("treats missing, invalid, and future timestamps as eligible", async (t) => {
  const invalidValues = [undefined, null, -1, NaN, Infinity, -Infinity, "invalid", {}, START_TIME + 1];
  for (const value of invalidValues) {
    const { cache, values } = createFixture(value);
    assert.equal(await cache.shouldUpdate(), true, `timestamp: ${String(value)}`);
    assert.equal(values.get(KEY), START_TIME);
  }

  // Zero is a valid timestamp, not an empty-cache sentinel.
  await t.test("accepts a timestamp at the Unix epoch", async () => {
    const { cache, clock } = createFixture(0);
    clock.now = 1;
    assert.equal(await cache.shouldUpdate(), false);
  });
});

void test("logs persistence failures and retains the cooldown in memory", async (t) => {
  const { cache, clock, state } = createFixture();
  const failure = new Error("Storage unavailable");
  const update = t.mock.method(state, "update", async () => { throw failure; });
  const warn = t.mock.method(console, "warn", () => {});

  assert.equal(await cache.shouldUpdate(), true);
  assert.equal(await cache.shouldUpdate(), false);
  assert.equal(update.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0].arguments[1], failure);

  clock.now += DAY_MS;
  assert.equal(await cache.shouldUpdate(), true);
  assert.equal(update.mock.callCount(), 2);
});
