# eisonAI3 Plugins

Central plugin store for eisonAI3. All source collectors, the JavaScript
protocol, the registry, contribution documentation, fixtures, and contract
tests live in this repository.

Community contributors add or update a plugin through a pull request to this
repository. A plugin's production artifact remains one self-contained
`plugin.js`; test files and fixtures stay beside it for review.

## Layout

```text
registry.json
protocol/
plugins/
  x/
    plugin.js
  xiaohongshu/
    plugin.js
```

The App downloads only entries listed in `registry.json` and verifies the
declared SHA-256 before execution. The registry, Protocol, plugins, fixtures,
and CI therefore change together in one reviewable pull request.

## Validate everything

```bash
npm ci --prefix plugins/x
npm ci --prefix plugins/xiaohongshu
npm run check
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) to add a source plugin.

