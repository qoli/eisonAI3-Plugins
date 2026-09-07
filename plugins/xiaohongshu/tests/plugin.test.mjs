import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const source = await readFile(new URL("../plugin.js", import.meta.url), "utf8");

function loadFixture(body, url, { viewport } = {}) {
  const { document, window } = parseHTML(`<!doctype html><html><body>${body}</body></html>`);
  const location = new URL(url);
  Object.defineProperty(document.documentElement, "scrollHeight", { value: viewport?.scrollHeight ?? 1200 });
  let plugin;
  const sandbox = {
    URL,
    console,
    document,
    location,
    innerHeight: viewport?.innerHeight ?? 800,
    scrollY: viewport?.scrollY ?? 0,
    eison: { registerPlugin(value) { plugin = value; } }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: "plugin.js" });
  return plugin;
}

const profile = "https://www.xiaohongshu.com/user/profile/account-123?tab=fav&subTab=note";

function favoritePage(extra = "") {
  return `
    <main class="user-page">
      <h1 class="user-name">測試帳號</h1>
      <div class="reds-tab-item active sub-tab-list">收藏</div>
      <div class="feeds-container">
        <section class="note-item" data-note-id="note-1">
          <a class="cover" href="https://www.xiaohongshu.com/explore/note-1?xsec_token=token"><img src="https://sns-img.example/cover.webp" width="1200" height="1600"></a>
          <a class="title">第一篇筆記</a>
          <a class="author" href="https://www.xiaohongshu.com/user/profile/author-1?xsec_source=pc_collect">作者甲</a>
        </section>
      </div>
      ${extra}
    </main>`;
}

test("describe returns the two distinct collections", async () => {
  const plugin = loadFixture("", profile);
  const response = await plugin.run({ operation: "describe" });
  assert.equal(response.status, "ready");
  assert.deepEqual(Array.from(response.manifest.collections, item => item.id), ["favorites", "liked"]);
});

test("probe verifies the active favorite source and account", async () => {
  const plugin = loadFixture(favoritePage(), profile);
  const response = await plugin.run({ operation: "probe", collectionID: "favorites" });
  assert.equal(response.status, "ready");
  assert.equal(response.collectionID, "favorites");
  assert.equal(response.sourceAccount.id, "account-123");
});

test("liked remains a distinct collection with its own source marker", async () => {
  const html = favoritePage()
    .replace("收藏", "点赞")
    .replace("pc_collect", "pc_like");
  const likedURL = "https://www.xiaohongshu.com/user/profile/account-123?tab=liked&subTab=note";
  const plugin = loadFixture(html, likedURL);
  const response = await plugin.run({ operation: "collect", collectionID: "liked" });
  assert.equal(response.status, "batch");
  assert.equal(response.collectionID, "liked");
});

test("collect returns a canonical visible batch without persistence concerns", async () => {
  const plugin = loadFixture(favoritePage(), profile);
  const response = await plugin.run({ operation: "collect", collectionID: "favorites", limit: 10 });
  assert.equal(response.status, "batch");
  assert.equal(response.records.length, 1);
  assert.equal(response.records[0].canonicalURL, "https://www.xiaohongshu.com/explore/note-1");
  assert.equal(response.records[0].media[0].url, "https://sns-img.example/cover.webp");
  assert.equal(response.next.kind, "scroll");
});

test("collection marker mismatch is a source structure error", async () => {
  const html = favoritePage().replace("pc_collect", "pc_like");
  const plugin = loadFixture(html, profile);
  const response = await plugin.run({ operation: "collect", collectionID: "favorites" });
  assert.equal(response.status, "sourceStructureChanged");
  assert.equal(response.diagnostics.code, "collectionSourceMarkerMismatch");
});

test("an empty list never becomes endConfirmed without explicit stable evidence", async () => {
  const html = `<main class="user-page"><div class="reds-tab-item active sub-tab-list">收藏</div><div class="feeds-container"></div></main>`;
  const plugin = loadFixture(html, profile, { viewport: { scrollY: 400, innerHeight: 800, scrollHeight: 1200 } });
  const response = await plugin.run({ operation: "collect", collectionID: "favorites" });
  assert.equal(response.status, "endUnconfirmed");
  assert.equal(response.diagnostics.code, "noNewVisibleRecords");
});

test("explicit end requires two stable bottom observations", async () => {
  const plugin = loadFixture(favoritePage('<div class="end-container">没有更多了</div>'), profile, {
    viewport: { scrollY: 400, innerHeight: 800, scrollHeight: 1200 }
  });
  const first = await plugin.run({ operation: "collect", collectionID: "favorites" });
  assert.equal(first.status, "batch");
  const second = await plugin.run({ operation: "collect", collectionID: "favorites", cursor: first.cursor });
  assert.equal(second.status, "endConfirmed");
  assert.equal(second.diagnostics.code, "explicitStableEnd");
});

test("login and verification are explicit states", async () => {
  const loginPlugin = loadFixture('<div class="login-container">扫码登录</div>', "https://www.xiaohongshu.com/login");
  assert.equal((await loginPlugin.run({ operation: "probe", collectionID: "favorites" })).status, "needsLogin");

  const verificationPlugin = loadFixture('<div class="captcha">安全验证</div>', `${profile}&error_code=300013`);
  assert.equal((await verificationPlugin.run({ operation: "probe", collectionID: "favorites" })).status, "needsUserVerification");
});

test("detail reads ordered rendered media and text", async () => {
  const html = `
    <article id="noteContainer">
      <h1 id="detail-title">完整標題</h1>
      <div id="detail-desc"><span class="note-text">完整正文</span></div>
      <div class="swiper-slide"><img src="https://sns-img.example/1.webp" width="1200" height="1600"></div>
      <div class="swiper-slide"><img src="https://sns-img.example/2.webp" width="1200" height="900"></div>
    </article>`;
  const plugin = loadFixture(html, "https://www.xiaohongshu.com/explore/note-1");
  const response = await plugin.run({ operation: "detail", sourceItemID: "note-1" });
  assert.equal(response.status, "batch");
  assert.deepEqual(Array.from(response.records[0].media, item => item.order), [0, 1]);
  assert.equal(response.records[0].text, "完整正文");
});

test("missing detail media is reported instead of returning partial data", async () => {
  const html = '<article id="noteContainer"><h1 id="detail-title">標題</h1><div id="detail-desc">正文</div></article>';
  const plugin = loadFixture(html, "https://www.xiaohongshu.com/explore/note-1");
  const response = await plugin.run({ operation: "detail", sourceItemID: "note-1" });
  assert.equal(response.status, "sourceStructureChanged");
  assert.equal(response.diagnostics.code, "detailMediaMissing");
});
