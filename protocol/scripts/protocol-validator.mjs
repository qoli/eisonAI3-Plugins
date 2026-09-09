import { readFile } from "node:fs/promises";
import vm from "node:vm";

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const RESPONSE_STATUSES = new Set([
  "ready",
  "needsLogin",
  "needsUserVerification",
  "batch",
  "sourceStructureChanged",
  "temporaryNetworkFailure",
  "rateLimited",
  "endConfirmed",
  "endUnconfirmed"
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertJSONCompatible(value, label) {
  invariant(value !== undefined, `${label} must not be undefined`);
  const encoded = JSON.stringify(value);
  invariant(typeof encoded === "string", `${label} must be JSON-compatible`);
  const decoded = JSON.parse(encoded);
  invariant(decoded !== null && typeof decoded === "object", `${label} must be a JSON object`);
  return decoded;
}

export function validateManifest(manifest) {
  const value = assertJSONCompatible(manifest, "plugin manifest");
  invariant(ID_PATTERN.test(value.id || ""), "plugin manifest id is invalid");
  invariant(typeof value.displayName === "string" && value.displayName.length > 0, "plugin manifest displayName is required");
  invariant(value.protocolVersion === 0, "plugin manifest protocolVersion must be 0");
  invariant(typeof value.revision === "string" && value.revision.length > 0, "plugin manifest revision is required");
  if (value.browserProfile !== undefined) {
    invariant(value.browserProfile === "systemSafari", "plugin manifest browserProfile is invalid");
  }
  invariant(Array.isArray(value.allowedOrigins) && value.allowedOrigins.length > 0, "plugin manifest allowedOrigins is required");
  for (const origin of value.allowedOrigins) {
    const url = new URL(origin);
    invariant(url.protocol === "https:" && url.origin === origin, `plugin allowed origin is invalid: ${origin}`);
  }
  invariant(typeof value.loginURL === "string" && value.loginURL.length > 0, "plugin manifest loginURL is required");
  const loginURL = new URL(value.loginURL);
  invariant(loginURL.protocol === "https:", "plugin manifest loginURL must use HTTPS");
  invariant(value.allowedOrigins.includes(loginURL.origin), "plugin manifest loginURL origin must be allowed");
  invariant(Array.isArray(value.collections) && value.collections.length > 0, "plugin manifest collections is required");
  invariant(value.capabilities && typeof value.capabilities === "object", "plugin manifest capabilities is required");
  for (const key of ["sourceSavedAt", "resumableCursor", "detailNavigation", "orderedMedia"]) {
    invariant(typeof value.capabilities[key] === "boolean", `plugin capability ${key} must be boolean`);
  }
  return value;
}

export function validateResponse(response) {
  const value = assertJSONCompatible(response, "plugin response");
  invariant(RESPONSE_STATUSES.has(value.status), `plugin response status is invalid: ${value.status}`);
  if (value.status === "batch") {
    invariant(Array.isArray(value.records) && value.records.length > 0, "batch response records must be non-empty");
  }
  if (value.status === "sourceStructureChanged") {
    invariant(value.diagnostics && typeof value.diagnostics === "object", "sourceStructureChanged requires diagnostics");
  }
  return value;
}

export async function loadPlugin(filePath) {
  const source = await readFile(filePath, "utf8");
  let registered = null;
  let registrationCount = 0;
  const sandbox = {
    URL,
    console,
    globalThis: null,
    eison: {
      registerPlugin(plugin) {
        registrationCount += 1;
        registered = plugin;
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath, timeout: 1_000 });
  invariant(registrationCount === 1, `plugin must register exactly once; observed ${registrationCount}`);
  invariant(registered && typeof registered === "object", "plugin registration must be an object");
  invariant(typeof registered.run === "function", "plugin run interface is required");
  validateManifest(registered.manifest);
  const described = await registered.run({ operation: "describe" });
  validateResponse(described);
  invariant(described.status === "ready", "describe response status must be ready");
  invariant(JSON.stringify(described.manifest) === JSON.stringify(registered.manifest), "describe response must return the registered manifest");
  return registered;
}
