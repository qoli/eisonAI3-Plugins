import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const pluginSource = await readFile(new URL("../plugin.js", import.meta.url), "utf8");
const likesFixture = await readFile(new URL("./fixtures/likes.html", import.meta.url), "utf8");

function loadPlugin(html, href = "https://x.com/i/history/likes") {
  const { document, window } = parseHTML(html);
  const url = new URL(href);
  let plugin = null;
  let registrationCount = 0;
  Object.defineProperties(window, {
    scrollY: { value: 0, writable: true },
    innerHeight: { value: 800, writable: true }
  });
  Object.defineProperty(document.documentElement, "scrollHeight", { value: 1600, configurable: true });
  const sandbox = {
    URL,
    document,
    window,
    location: {
      href: url.href,
      origin: url.origin,
      pathname: url.pathname
    },
    eison: {
      registerPlugin(candidate) {
        registrationCount += 1;
        plugin = candidate;
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(pluginSource, sandbox, { filename: "plugin.js" });
  assert.equal(registrationCount, 1);
  return plugin;
}

test("registers exactly once and describes the draft-v0 manifest", async () => {
  const plugin = loadPlugin("<html></html>", "https://example.com/");
  const response = await plugin.run({ operation: "describe" });
  assert.equal(response.status, "ready");
  assert.equal(response.manifest.id, "x.likes");
  assert.equal(response.manifest.loginURL, "https://x.com/i/flow/login");
  assert.equal(response.manifest.capabilities.detailNavigation, false);
});

test("probe verifies the authenticated source account", async () => {
  const plugin = loadPlugin(likesFixture);
  const response = await plugin.run({ operation: "probe" });
  assert.equal(response.status, "ready");
  assert.equal(response.collectionID, "likes");
  assert.deepEqual(JSON.parse(JSON.stringify(response.sourceAccount)), {
    id: "ronniewong",
    displayName: "Ronnie"
  });
});

test("probe returns explicit login and verification states", async () => {
  const login = loadPlugin('<a data-testid="loginButton" href="/login">Log in</a>');
  assert.equal((await login.run({ operation: "probe" })).status, "needsLogin");

  const loginRedirect = loadPlugin("<html></html>", "https://x.com/i/flow/login");
  assert.equal((await loginRedirect.run({ operation: "probe" })).status, "needsLogin");

  const verification = loadPlugin('<iframe src="https://client-api.arkoselabs.com/challenge"></iframe>');
  assert.equal((await verification.run({ operation: "probe" })).status, "needsUserVerification");

  const verificationRedirect = loadPlugin("<html></html>", "https://x.com/account/access");
  assert.equal((await verificationRedirect.run({ operation: "probe" })).status, "needsUserVerification");
});

test("probe reports changed structure instead of inventing account identity", async () => {
  const plugin = loadPlugin('<main data-testid="primaryColumn"></main>');
  const response = await plugin.run({ operation: "probe" });
  assert.equal(response.status, "sourceStructureChanged");
  assert.match(response.diagnostics.invariant, /source account identity/);
});

test("collect extracts canonical records, ordered media, and omits promoted posts", async () => {
  const plugin = loadPlugin(likesFixture);
  const response = await plugin.run({ operation: "collect", collectionID: "likes", limit: 10 });
  assert.equal(response.status, "batch");
  assert.equal(response.records.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(response.records.map(record => record.id))), ["1001", "1002"]);
  assert.equal(response.records[0].url, "https://x.com/alice/status/1001");
  assert.equal(response.records[0].media[0].type, "image");
  assert.equal(response.records[1].media[0].type, "video");
  assert.deepEqual(JSON.parse(JSON.stringify(response.next)), {
    kind: "scroll",
    deltaViewportRatio: 0.82
  });
});

test("collect expands show-more controls before returning records", async () => {
  const html = likesFixture.replace(
    '<div data-testid="tweetText">First liked post</div>',
    '<div data-testid="tweetText">First liked post</div><button data-testid="tweet-text-show-more-link">Show more</button>'
  );
  const plugin = loadPlugin(html);
  const control = plugin.run;
  const response = await control({ operation: "collect", collectionID: "likes" });
  assert.equal(response.status, "ready");
  assert.equal(response.next.kind, "wait");
  assert.equal(response.diagnostics.expandedControlCount, 1);
});

test("an empty collection observation is endUnconfirmed, never endConfirmed", async () => {
  const html = `
    <button data-testid="SideNav_AccountSwitcher_Button">Ronnie<br>@RonnieWong</button>
    <main data-testid="primaryColumn"></main>
  `;
  const plugin = loadPlugin(html);
  const response = await plugin.run({ operation: "collect", collectionID: "likes" });
  assert.equal(response.status, "endUnconfirmed");
  assert.match(response.diagnostics.invariant, /cannot prove collection exhaustion/);
});

test("malformed visible source records fail as sourceStructureChanged", async () => {
  const html = `
    <button data-testid="SideNav_AccountSwitcher_Button">Ronnie<br>@RonnieWong</button>
    <main data-testid="primaryColumn">
      <article data-testid="tweet"><div data-testid="tweetText">No status URL</div></article>
    </main>
  `;
  const plugin = loadPlugin(html);
  const response = await plugin.run({ operation: "collect", collectionID: "likes" });
  assert.equal(response.status, "sourceStructureChanged");
  assert.match(response.diagnostics.invariant, /canonical X status URL/);
});

test("detail explicitly reports that navigation is unsupported", async () => {
  const plugin = loadPlugin(likesFixture);
  const response = await plugin.run({ operation: "detail", sourceItemID: "1001" });
  assert.equal(response.status, "ready");
  assert.equal(response.diagnostics.supported, false);
});

test("invalid collection and unknown operations fail explicitly", async () => {
  const plugin = loadPlugin(likesFixture);
  await assert.rejects(
    async () => plugin.run({ operation: "collect", collectionID: "bookmarks" }),
    /requires collectionID/
  );
  await assert.rejects(
    async () => plugin.run({ operation: "unknown" }),
    /unsupported X Likes plugin operation/
  );
});
