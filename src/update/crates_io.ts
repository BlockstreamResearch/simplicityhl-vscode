import { parse } from "semver";

import {
  MANAGED_BINARY_CRATE_NAMES,
  ManagedBinary,
} from "../contracts";

/** A SemVer value that has been checked to be safe as a Cargo argument. */
export type CrateVersion = string & { readonly __crateVersion: unique symbol };

export type FetchLike = typeof globalThis.fetch;

export const CRATES_IO_API_URL = "https://crates.io/api/v1/crates";
export const CRATES_IO_USER_AGENT =
  "simplicityhl-vscode (https://github.com/BlockstreamResearch/simplicityhl-vscode)";

function asCrateVersion(value: unknown): CrateVersion {
  if (
    typeof value !== "string" ||
    parse(value)?.version !== value.split("+", 1)[0]
  ) {
    throw new Error("crates.io returned an invalid crate default_version");
  }

  return value as CrateVersion;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fetch the default version of the crates.io crate managed by `binary`. */
export async function getCrateVersion(
  binary: ManagedBinary,
  fetchFunction: FetchLike = globalThis.fetch,
): Promise<CrateVersion> {
  const crateName = MANAGED_BINARY_CRATE_NAMES[binary];

  const response = await fetchFunction(`${CRATES_IO_API_URL}/${crateName}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": CRATES_IO_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`crates.io request failed with HTTP status ${String(response.status)}`);
  }

  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.crate)) {
    throw new Error("crates.io returned an invalid response body");
  }

  return asCrateVersion(body.crate.default_version);
}
