import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  CRATES_IO_USER_AGENT,
  getCrateVersion,
} from "./crates_io";
import type { CrateVersion } from "./crates_io";
import { ManagedBinary } from "../contracts";

interface Request {
  readonly input: string;
  readonly init: RequestInit;
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

void test("requests simfmt metadata with the crates.io headers", async () => {
  const requests: Request[] = [];
  const version = await getCrateVersion(ManagedBinary.Simfmt, async (input, init = {}) => {
    requests.push({ input: String(input), init });
    return response(200, { crate: { default_version: "1.2.3" } });
  });

  assert.equal(version, "1.2.3");
  assert.deepEqual(requests, [
    {
      input: "https://crates.io/api/v1/crates/simfmt",
      init: {
        headers: {
          Accept: "application/json",
          "User-Agent": CRATES_IO_USER_AGENT,
        },
      },
    },
  ]);
});

void test("accepts SemVer prerelease and build metadata", async () => {
  const version = await getCrateVersion(ManagedBinary.Simfmt, async () =>
    response(200, { crate: { default_version: "1.2.3-rc.1+build.7" } }),
  );

  const typedVersion: CrateVersion = version;
  assert.equal(typedVersion, "1.2.3-rc.1+build.7");
});

void test("rejects malformed crates.io response bodies", async () => {
  for (const body of [
    null,
    [],
    {},
    { crate: null },
    { crate: {} },
    { crate: { default_version: 123 } },
  ]) {
    await assert.rejects(
      () => getCrateVersion(ManagedBinary.Simfmt, async () => response(200, body)),
      /invalid (?:response body|crate default_version)/,
    );
  }
});

void test("rejects versions that are not safe SemVer-like Cargo arguments", async () => {
  for (const defaultVersion of [
    "1.2",
    "v1.2.3",
    "1.2.3 foo",
    "1.2.3; touch /tmp/pwned",
    "1.2.3\n--config",
    "01.2.3",
  ]) {
    await assert.rejects(
      () =>
        getCrateVersion(ManagedBinary.Simfmt, async () =>
          response(200, { crate: { default_version: defaultVersion } }),
        ),
      /invalid crate default_version/,
    );
  }
});

void test("rejects non-2xx responses", async () => {
  await assert.rejects(
    () => getCrateVersion(ManagedBinary.Simfmt, async () => response(503, {})),
    /HTTP status 503/,
  );
});

void test("propagates fetch failures", async () => {
  const failure = new Error("network unavailable");
  await assert.rejects(
    () =>
      getCrateVersion(ManagedBinary.Simfmt, async () => {
        throw failure;
      }),
    failure,
  );
});

void test("rejects unsupported binaries without making a request", async () => {
  let requestCount = 0;
  await assert.rejects(
    () =>
      getCrateVersion(ManagedBinary.LanguageServer, async () => {
        requestCount += 1;
        return response(200, { crate: { default_version: "1.2.3" } });
      }),
    /No crates.io crate is registered/,
  );
  assert.equal(requestCount, 0);
});
