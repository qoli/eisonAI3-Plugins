# eisonAI3 Xiaohongshu Plugin

Xiaohongshu browser collector for the draft eisonAI3 JavaScript plugin
protocol. The distributable runtime artifact is the single self-contained
[`plugin.js`](./plugin.js) file.

It supports four host operations:

- `describe`: returns its draft-v0 manifest.
- `probe`: verifies login, profile identity, active collection, and feed shape.
- `collect`: extracts one visible batch from either `favorites` (收藏) or
  `liked` (点赞), preserving the two collections as distinct sources.
- `detail`: extracts rendered title/text and ordered media metadata from the
  currently open note page.

The plugin only reads the page DOM. It contains no CDP transport, Node APIs,
checkpoint/database access, or media persistence. In particular it does not
depend on page-world globals, which are unavailable from an isolated named
`WKContentWorld`.
The native host owns navigation, scrolling/waiting, storage, retries, and asset
downloads.

## Failure and completion semantics

Login and risk-control pages return `needsLogin` or
`needsUserVerification`. Missing or malformed expected DOM returns
`sourceStructureChanged` with diagnostics. A visible empty batch returns
`endUnconfirmed`; `endConfirmed` requires a recognized end/empty marker, the
viewport at the bottom, no loading indicator, and the same DOM signature in
two consecutive cursor-bearing calls.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm test
```

`npm test` runs DOM fixture tests with LinkeDOM and then invokes the centralized
validator under `protocol/`.

## Current validation boundary

Fixtures cover the draft protocol and known DOM shapes extracted
from the previous Arc CDP prototype. Live logged-in WKWebView behavior, current
production selectors, Xiaohongshu risk controls, scrolling stability, video
metadata, and authenticated media downloads still require on-device host
validation.
