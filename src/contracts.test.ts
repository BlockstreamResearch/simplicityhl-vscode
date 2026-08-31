import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { SETTINGS, languageClientOptions } from "./contracts";

void test("client languages and consumed settings match package contributions", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"),
  );
  const contributions = manifest.contributes;
  const clientOptions = languageClientOptions({ imports: true, enums: false });

  assert.deepEqual(
    clientOptions.documentSelector.map(({ language }) => language),
    contributions.languages.map((language: { id: string }) => language.id),
  );

  const contributedSettings = Object.assign(
    {},
    ...contributions.configuration.map(
      (section: { properties: Record<string, unknown> }) => section.properties,
    ),
  ) as Record<string, { default?: unknown }>;

  for (const setting of [
    SETTINGS.serverPath,
    SETTINGS.imports,
    SETTINGS.enums,
  ]) {
    const contribution =
      contributedSettings[
        `${clientOptions.synchronize.configurationSection}.${setting.key}`
      ];
    assert.ok(contribution, `Missing package contribution for ${setting.key}`);
    assert.equal(contribution.default, setting.default);
  }

  assert.deepEqual(manifest.activationEvents, ["onStartupFinished"]);
});
