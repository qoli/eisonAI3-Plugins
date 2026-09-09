#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlugin } from "./protocol-validator.mjs";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

const registryURL = new URL("../../registry.json", import.meta.url);
const registry = JSON.parse(await readFile(registryURL, "utf8"));
const useLocalArtifacts = process.argv.includes("--local");
invariant(registry.protocolVersion === 0, "registry protocolVersion must be 0");
invariant(Array.isArray(registry.plugins) && registry.plugins.length > 0, "registry plugins must not be empty");

const seen = new Set();
const temporaryDirectory = await mkdtemp(join(tmpdir(), "eison-registry-"));
for (const descriptor of registry.plugins) {
  invariant(typeof descriptor.id === "string" && descriptor.id.length > 0, "registry plugin id is required");
  invariant(!seen.has(descriptor.id), `duplicate registry plugin id: ${descriptor.id}`);
  seen.add(descriptor.id);
  invariant(/^https:\/\//.test(descriptor.scriptURL), `plugin scriptURL must use HTTPS: ${descriptor.id}`);
  invariant(/^plugins\/[a-z0-9.-]+\/plugin\.js$/.test(descriptor.scriptPath), `plugin scriptPath is invalid: ${descriptor.id}`);
  invariant(/^[0-9a-f]{64}$/.test(descriptor.sha256), `plugin sha256 is invalid: ${descriptor.id}`);
  invariant(/^https:\/\//.test(descriptor.startURL), `plugin startURL must use HTTPS: ${descriptor.id}`);
  if (descriptor.browserProfile !== undefined) {
    invariant(descriptor.browserProfile === "mobileSafari", `plugin browserProfile is invalid: ${descriptor.id}`);
  }

  let source;
  if (useLocalArtifacts) {
    source = await readFile(new URL(`../../${descriptor.scriptPath}`, import.meta.url), "utf8");
  } else {
    const response = await fetch(descriptor.scriptURL);
    invariant(response.ok, `plugin download failed for ${descriptor.id}: HTTP ${response.status}`);
    source = await response.text();
  }
  const actualHash = createHash("sha256").update(source).digest("hex");
  invariant(actualHash === descriptor.sha256, `plugin hash mismatch for ${descriptor.id}: ${actualHash}`);
  const path = join(temporaryDirectory, `${descriptor.id}.js`);
  await writeFile(path, source);
  const plugin = await loadPlugin(path);
  invariant(plugin.manifest.id === descriptor.id, `plugin manifest id mismatch for ${descriptor.id}`);
  invariant(
    plugin.manifest.browserProfile === descriptor.browserProfile,
    `plugin browserProfile mismatch for ${descriptor.id}`
  );
  process.stdout.write(`${descriptor.id} ${descriptor.sha256}: registry artifact valid\n`);
}
