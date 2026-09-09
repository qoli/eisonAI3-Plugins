# eisonAI3 X Likes plugin

The X Likes adapter for the draft eisonAI3 JavaScript plugin protocol. Its
runtime artifact is the single, self-contained [`plugin.js`](./plugin.js).

The plugin reads the current `https://x.com/i/history/likes` DOM inside a named
`WKContentWorld`. It does not connect to CDP, access cookies, use Node APIs,
persist checkpoints, write a database, or download media. Those capabilities
belong to the eisonAI3 native host.

The manifest declares `https://x.com/i/flow/login` as the host-driven sign-in
destination. It also declares the `mobileSafari` browser profile because X
redirects Likes routes away from an embedded-WebView identity before plugin
JavaScript can run. The native host applies the declared profile generically;
the plugin remains responsible for requesting and matching it.

## Operations

- `describe` returns the immutable draft-v0 manifest without reading the page.
- `probe` verifies the X Likes URL, authentication, account identity, and
  minimum page structure.
- `collect` expands visible truncated posts, then extracts one visible batch.
  It returns ordered media references but does not persist their contents.
- `detail` explicitly reports `supported: false`; X Likes uses the timeline
  record as its complete collection representation.

The adapter never treats an empty visible timeline as confirmed exhaustion.
X virtualizes and asynchronously loads its timeline, so an empty batch returns
`endUnconfirmed` with the observed scroll/loading diagnostics. The host decides
whether to wait, scroll, retry, or stop and owns any cross-call progress state.

Authentication, interactive verification, missing account identity, and
changed source structure are returned as explicit protocol states. Invalid
requests throw an error instead of manufacturing defaults.

## Development

Requires Node.js 20 or later.

```bash
npm install
npm run check
```

`npm run validate` invokes the centralized validator under `protocol/`. DOM
fixture tests use `linkedom`; they do not make network requests or prove
compatibility with the current live X DOM.

## Host collection loop

The host should first navigate an authenticated web view to the Likes URL and
call `probe`. On `collect`, it must execute the returned `next` action and call
again. It should de-duplicate canonical source IDs across batches. A returned
media URL is a source reference only, not evidence that the media was saved.

## License

MIT
