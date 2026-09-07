import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPlugin, validateResponse } from "../scripts/protocol-validator.mjs";

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
