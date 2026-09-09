import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const pluginSource = await readFile(new URL("../plugin.js", import.meta.url), "utf8");
const likesFixture = await readFile(new URL("./fixtures/likes.html", import.meta.url), "utf8");

function loadPlugin(html, href = "https://x.com/i/history/likes", cookie = "") {
  const { document, window } = parseHTML(html);
  document.elementFromPoint = () => null;
  Object.defineProperty(document, "cookie", { value: cookie, configurable: true });
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
  assert.equal(response.manifest.browserProfile, "mobileSafari");
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

test("probe uses the stable authenticated user id from the readable twid cookie", async () => {
  const plugin = loadPlugin(
    '<main data-testid="primaryColumn"></main>',
    "https://x.com/i/history/likes",
    "lang=zh-tw; twid=u%3D123456789%7Csigned; ct0=redacted"
  );
  const response = await plugin.run({ operation: "probe" });
  assert.equal(response.status, "ready");
  assert.deepEqual(JSON.parse(JSON.stringify(response.sourceAccount)), {
    id: "123456789",
    displayName: null
  });
});

test("malformed twid cookie fails identity instead of falling through to DOM identity", async () => {
  const html = `
    <a href="/RonnieWong"><img src="https://pbs.twimg.com/profile_images/self.jpg"></a>
    <main data-testid="primaryColumn"></main>
  `;
  const plugin = loadPlugin(html, "https://x.com/i/history/likes", "twid=malformed");
  const response = await plugin.run({ operation: "probe" });
  assert.equal(response.status, "sourceStructureChanged");
});

test("probe verifies the authenticated source account in the compact navigation", async () => {
  const html = `
    <a href="/RonnieWong"><img src="https://pbs.twimg.com/profile_images/self.jpg"></a>
    <main data-testid="primaryColumn"></main>
  `;
  const plugin = loadPlugin(html);
  const response = await plugin.run({ operation: "probe" });
  assert.equal(response.status, "ready");
  assert.deepEqual(JSON.parse(JSON.stringify(response.sourceAccount)), {
    id: "ronniewong",
    displayName: null
  });
});

test("probe verifies compact identity from the account avatar container", async () => {
  const html = `
    <div data-testid="UserAvatar-Container-0xCheshire"></div>
    <main data-testid="primaryColumn"></main>
  `;
  const plugin = loadPlugin(html);
  const response = await plugin.run({ operation: "probe" });
  assert.equal(response.status, "ready");
  assert.deepEqual(JSON.parse(JSON.stringify(response.sourceAccount)), {
    id: "0xcheshire",
    displayName: null
  });
});

test("compact avatar identity excludes tweet authors and rejects malformed handles", async () => {
  const html = `
    <main data-testid="primaryColumn">
      <article data-testid="tweet">
        <div data-testid="UserAvatar-Container-author"></div>
      </article>
      <div data-testid="UserAvatar-Container-handle-is-too-long"></div>
    </main>
  `;
  const plugin = loadPlugin(html);
  const response = await plugin.run({ operation: "probe" });
  assert.equal(response.status, "sourceStructureChanged");
});

test("compact avatar identity rejects multiple authenticated candidates", async () => {
  const html = `
    <div data-testid="UserAvatar-Container-first"></div>
    <div data-testid="UserAvatar-Container-second"></div>
    <main data-testid="primaryColumn"></main>
  `;
  const plugin = loadPlugin(html);
  const response = await plugin.run({ operation: "probe" });
  assert.equal(response.status, "sourceStructureChanged");
});

test("compact navigation does not infer identity from a non-profile route", async () => {
  const html = `
    <a href="/i/history/likes"><img src="https://pbs.twimg.com/profile_images/not-a-profile.jpg"></a>
    <main data-testid="primaryColumn"></main>
  `;
  const plugin = loadPlugin(html);
  const response = await plugin.run({ operation: "probe" });
  assert.equal(response.status, "sourceStructureChanged");
  assert.match(response.diagnostics.invariant, /source account identity/);
});

test("compact navigation rejects ambiguous account identity", async () => {
  const html = `
    <a href="/first"><img src="https://pbs.twimg.com/profile_images/first.jpg"></a>
    <a href="/second"><img src="https://pbs.twimg.com/profile_images/second.jpg"></a>
    <main data-testid="primaryColumn"></main>
  `;
  const plugin = loadPlugin(html);
  const response = await plugin.run({ operation: "probe" });
  assert.equal(response.status, "sourceStructureChanged");
});

test("compact navigation never infers identity from a tweet author", async () => {
  const html = `
    <main data-testid="primaryColumn">
      <article data-testid="tweet">
        <a href="/author"><img src="https://pbs.twimg.com/profile_images/author.jpg"></a>
      </article>
    </main>
  `;
  const plugin = loadPlugin(html);
  const response = await plugin.run({ operation: "probe" });
  assert.equal(response.status, "sourceStructureChanged");
});

test("probe returns explicit login and verification states", async () => {
  const login = loadPlugin('<a data-testid="loginButton" href="/login">Log in</a>');
  assert.equal((await login.run({ operation: "probe" })).status, "needsLogin");

  const loginRedirect = loadPlugin("<html></html>", "https://x.com/i/flow/login");
  assert.equal((await loginRedirect.run({ operation: "probe" })).status, "needsLogin");

  const onboarding = loadPlugin(
    "<html></html>",
    "https://x.com/i/jf/onboarding/web?redirect_after_login=%2Fi%2Fhistory%2Flikes&mode=login"
  );
  assert.equal((await onboarding.run({ operation: "probe" })).status, "needsLogin");

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

test("ordinary posts are not rejected for an inner media placement tracker", async () => {
  const html = `
    <button data-testid="SideNav_AccountSwitcher_Button">Ronnie<br>@RonnieWong</button>
    <main data-testid="primaryColumn">
      <article data-testid="tweet">
        <a href="/alice/status/1001"><time datetime="2026-09-09T01:00:00.000Z"></time></a>
        <div data-testid="tweetText">Organic video post</div>
        <div data-testid="placementTracking"><video poster="https://pbs.twimg.com/video.jpg"></video></div>
      </article>
    </main>
  `;
  const plugin = loadPlugin(html);
  const response = await plugin.run({ operation: "collect", collectionID: "likes" });
  assert.equal(response.status, "batch");
  assert.equal(response.records[0].id, "1001");
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
