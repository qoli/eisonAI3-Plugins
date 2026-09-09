import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPlugin, validateManifest, validateResponse } from "../scripts/protocol-validator.mjs";

test("rejects a valid-looking empty batch", () => {
  assert.throws(
    () => validateResponse({ status: "batch", records: [] }),
    /records must be non-empty/
  );
});

test("requires diagnostic evidence for a changed source", () => {
  assert.throws(
    () => validateResponse({ status: "sourceStructureChanged" }),
    /requires diagnostics/
  );
});

test("requires an HTTPS login URL on an allowed origin", () => {
  const manifest = {
    id: "fixture",
    displayName: "Fixture",
    protocolVersion: 0,
    revision: "fixture-1",
    loginURL: "http://example.com/login",
    allowedOrigins: ["https://example.com"],
    collections: [{ id: "favorites", displayName: "Favorites", kind: "favorite" }],
    capabilities: {
      sourceSavedAt: false,
      resumableCursor: false,
      detailNavigation: false,
      orderedMedia: false
    }
  };
  assert.throws(() => validateManifest(manifest), /loginURL must use HTTPS/);
  manifest.loginURL = "https://auth.example.net/login";
  assert.throws(() => validateManifest(manifest), /loginURL origin must be allowed/);
  delete manifest.loginURL;
  assert.throws(() => validateManifest(manifest), /loginURL is required/);
});

test("loads exactly one plugin with a JSON describe response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eison-plugin-"));
  const filePath = join(directory, "plugin.js");
  await writeFile(filePath, `
    eison.registerPlugin({
      manifest: {
        id: "fixture",
        displayName: "Fixture",
        protocolVersion: 0,
        revision: "fixture-1",
        loginURL: "https://example.com/login",
        allowedOrigins: ["https://example.com"],
        collections: [{ id: "favorites", displayName: "Favorites", kind: "favorite" }],
        capabilities: {
          sourceSavedAt: false,
          resumableCursor: false,
          detailNavigation: false,
          orderedMedia: false
        }
      },
      run(request) {
        if (request.operation !== "describe") throw new Error("unsupported fixture operation");
        return { status: "ready", manifest: this.manifest };
      }
    });
  `);
  const plugin = await loadPlugin(filePath);
  assert.equal(plugin.manifest.id, "fixture");
});
