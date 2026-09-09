# Contributing a plugin

All eisonAI3 source plugins are reviewed in this repository.

## Directory contract

Create one directory under `plugins/<plugin-id>/` containing:

```text
plugin.js              # the only production runtime artifact
README.md
package.json           # test tooling only
package-lock.json
test/ or tests/
  fixtures/
  *.test.mjs
```

`plugin.js` must register exactly once through
`globalThis.eison.registerPlugin({ manifest, run })`. It must not use Node APIs,
write storage, read cookies, contact a native message handler, or persist media.
The protocol and validator live under `protocol/`.

## Pull request requirements

1. Add or update the plugin and sanitized DOM fixtures.
2. Cover `describe`, `probe`, `collect`, and `detail` behaviour.
3. Preserve explicit `needsLogin`, `needsUserVerification`,
   `sourceStructureChanged`, and `endUnconfirmed` states where applicable.
4. Declare a required HTTPS `loginURL`.
5. If the source requires a `browserProfile`, declare the same supported value
   in the plugin manifest and registry descriptor.
6. Do not report `endConfirmed` without positive terminal evidence.
7. Update the plugin entry in `registry.json`, including `scriptPath`,
   `scriptURL`, and the exact lowercase SHA-256 of `plugin.js`.
8. Run `npm run check` at the repository root.

The registry hash is the runtime identity recorded with imported data. A hash
mismatch fails plugin activation explicitly; the App does not silently execute
different bytes.
