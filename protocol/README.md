# eisonAI3 Plugin Protocol

Draft JavaScript contract for eisonAI3 saved-content collectors.

A plugin is one self-contained JavaScript file. It runs inside a named
`WKContentWorld`, reads the current page DOM, and returns JSON-compatible data
to the native host. It does not write the database, read cookies, persist files,
or own import checkpoints.

The contract is intentionally draft until both the Xiaohongshu and X Likes
adapters have exercised it.

## Interface

The host installs exactly one registration function:

```js
globalThis.eison.registerPlugin(plugin)
```

The plugin registers exactly once with:

```js
{
  manifest: { /* metadata and declared capabilities */ },
  async run(request) { /* return a protocol response */ }
}
```

`run` is the only behavioural interface. Draft operations are:

- `describe`: return the manifest without reading page state.
- `probe`: verify the current URL, login/account state, collection, and page
  structure.
- `collect`: read one visible batch and return canonical source records plus a
  next action or explicit completion state.
- `detail`: read the currently open detail page for one source item.

Every response is JSON-compatible. Missing required source identity, malformed
page structure, and unconfirmed exhaustion are explicit errors; plugins must
not manufacture defaults or return a valid-looking empty collection.

## Validate a plugin

```bash
node protocol/scripts/validate-plugin.mjs plugins/x/plugin.js
```

The validator checks registration, manifest invariants, the single `run`
interface, and the JSON-only `describe` response. Plugin directories add DOM
fixture tests for their own `probe`, `collect`, and `detail` operations.

## Registry

[`registry.json`](../registry.json) is the independently updateable catalog read
by eisonAI3. Each entry points to its centralized `plugin.js` and includes its
SHA-256 digest. Updating a plugin does not require an App Store binary release,
but activating new bytes always requires the same pull request to update the
registry with a matching digest.

```bash
npm run validate:registry
```

Registry validation downloads each immutable artifact, verifies its digest,
and runs the same draft protocol validator. A missing artifact, hash mismatch,
or invalid plugin fails explicitly.

## Host ownership

The native host owns WKWebView lifecycle, website data stores, navigation
policy, script integrity, timeout/cancellation, schema validation, database
transactions, media persistence, checkpoints, and diagnostics.
