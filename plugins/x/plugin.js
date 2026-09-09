(function () {
  "use strict";

  const manifest = Object.freeze({
    id: "x.likes",
    displayName: "X Likes",
    protocolVersion: 0,
    revision: "draft-v0.4.3",
    loginURL: "https://x.com/i/flow/login",
    browserProfile: "mobileSafari",
    collections: [
      { id: "likes", displayName: "Likes", kind: "like" }
    ],
    capabilities: {
      sourceSavedAt: false,
      resumableCursor: false,
      detailNavigation: false,
      orderedMedia: true
    }
  });

  const LIKES_PATH = "/i/history/likes";

  function clean(value) {
    return value == null ? null : String(value).replace(/\s+/g, " ").trim() || null;
  }

  function pageDiagnostics(extra) {
    return Object.assign({
      url: location.href,
      title: document.title,
      readyState: document.readyState
    }, extra);
  }

  function canonicalStatusURL(href) {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, location.href);
    } catch (error) {
      return null;
    }
    if (url.origin !== "https://x.com") return null;
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)\/?$/);
    if (!match) return null;
    return `https://x.com/${match[1]}/status/${match[2]}`;
  }

  function currentPageProblem() {
    if (location.origin !== "https://x.com") {
      return {
        status: "sourceStructureChanged",
        diagnostics: pageDiagnostics({
          invariant: "current page must use the declared X origin",
          expectedOrigin: "https://x.com"
        })
      };
    }

    const verification = document.querySelector(
      'iframe[src*="arkoselabs"], iframe[src*="captcha"], [data-testid="ocfEnterTextTextInput"], form[action*="account/access"]'
    );
    if (verification || location.pathname.startsWith("/account/access")) {
      return {
        status: "needsUserVerification",
        collectionID: "likes",
        diagnostics: pageDiagnostics({
          invariant: "X requires interactive account verification"
        })
      };
    }

    const loginControl = document.querySelector(
      '[data-testid="loginButton"], a[href="/login"], a[href^="/i/flow/login"]'
    );
    if (
      loginControl
      || location.pathname === "/login"
      || location.pathname.startsWith("/i/flow/login")
      || location.pathname.startsWith("/i/jf/onboarding/web")
    ) {
      return {
        status: "needsLogin",
        collectionID: "likes",
        diagnostics: pageDiagnostics({
          invariant: "an authenticated X session is required"
        })
      };
    }

    if (location.pathname !== LIKES_PATH) {
      return {
        status: "sourceStructureChanged",
        diagnostics: pageDiagnostics({
          invariant: "current page must be the X Likes collection",
          expectedURL: `https://x.com${LIKES_PATH}`
        })
      };
    }

    return null;
  }

  function sourceAccount() {
    const accountControl = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (accountControl) {
      const lines = String(accountControl.innerText || accountControl.textContent || "")
        .split("\n")
        .map(clean)
        .filter(Boolean);
      const handle = lines.find(line => /^@[A-Za-z0-9_]{1,15}$/.test(line));
      if (handle) {
        const displayName = lines.find(line => line !== handle && line !== "More");
        return { id: handle.slice(1).toLowerCase(), displayName: displayName || null };
      }
    }

    const compactAccounts = new Map();
    for (const profileLink of document.querySelectorAll('a[href]')) {
      if (!profileLink.querySelector("img")) continue;
      if (profileLink.closest('article[data-testid="tweet"], [data-testid="UserCell"]')) continue;
      let profileURL;
      try {
        profileURL = new URL(profileLink.getAttribute("href"), location.href);
      } catch (error) {
        continue;
      }
      if (profileURL.origin !== "https://x.com") continue;
      const match = profileURL.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      if (!match) continue;
      compactAccounts.set(match[1].toLowerCase(), {
        id: match[1].toLowerCase(),
        displayName: null
      });
    }
    if (compactAccounts.size !== 1) return null;
    return compactAccounts.values().next().value;
  }

  function compactIdentityStructure() {
    return [...document.querySelectorAll("img")]
      .filter(image => !image.closest('article[data-testid="tweet"], [data-testid="UserCell"]'))
      .slice(0, 8)
      .map(image => {
        const ancestors = [];
        let element = image;
        for (let depth = 0; element && depth < 7; depth += 1, element = element.parentElement) {
          ancestors.push({
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role"),
            testID: element.getAttribute("data-testid"),
            hasHref: element.hasAttribute("href")
          });
        }
        return ancestors;
      });
  }

  function structureProblem() {
    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
    if (!primaryColumn) {
      if (document.querySelector('[role="progressbar"]')) {
        return {
          status: "ready",
          collectionID: "likes",
          next: { kind: "wait", milliseconds: 500 },
          diagnostics: pageDiagnostics({ observation: "X Likes shell is still loading" })
        };
      }
      return {
        status: "sourceStructureChanged",
        diagnostics: pageDiagnostics({
          invariant: "X primary column was not found",
          selector: '[data-testid="primaryColumn"]'
        })
      };
    }

    const account = sourceAccount();
    if (!account) {
      return {
        status: "sourceStructureChanged",
        diagnostics: pageDiagnostics({
          invariant: "authenticated source account identity was not found",
          selectors: [
            '[data-testid="SideNav_AccountSwitcher_Button"]',
            'a[href]:has(img):not(article[data-testid="tweet"] *, [data-testid="UserCell"] *)'
          ],
          compactIdentityStructure: compactIdentityStructure()
        })
      };
    }
    return null;
  }

  function mediaFor(article) {
    const media = [];
    const seen = new Set();

    for (const image of article.querySelectorAll('[data-testid="tweetPhoto"] img')) {
      const url = image.currentSrc || image.src || image.getAttribute("src");
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const width = Number(image.naturalWidth) || null;
      const height = Number(image.naturalHeight) || null;
      media.push({
        type: "image",
        url,
        width,
        height,
        aspectRatio: width && height ? width / height : null
      });
    }

    for (const video of article.querySelectorAll("video")) {
      const url = video.poster || video.currentSrc || video.src || video.getAttribute("poster") || video.getAttribute("src");
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const width = Number(video.videoWidth) || null;
      const height = Number(video.videoHeight) || null;
      media.push({
        type: "video",
        url,
        width,
        height,
        aspectRatio: width && height ? width / height : null
      });
    }

    return media;
  }

  function isPromoted(article) {
    if (article.querySelector('[data-testid="placementTracking"]')) return true;
    return /\bPromoted\b|\bAd\b|推廣|广告|廣告/i.test(article.innerText || article.textContent || "");
  }

  function recordFor(article) {
    const times = Array.from(article.querySelectorAll("time"));
    const mainAnchor = (times[0] && times[0].closest('a[href*="/status/"]'))
      || article.querySelector('a[href*="/status/"]');
    const url = canonicalStatusURL(mainAnchor && mainAnchor.getAttribute("href"));
    if (!url) {
      return { error: "tweet article has no canonical X status URL" };
    }
    const idMatch = url.match(/\/status\/(\d+)$/);
    if (!idMatch) {
      return { error: "canonical X status URL has no numeric source item id" };
    }

    const userName = article.querySelector('[data-testid="User-Name"]');
    const userLines = String((userName && (userName.innerText || userName.textContent)) || "")
      .split("\n")
      .map(clean)
      .filter(Boolean);
    const handle = userLines.find(line => line.startsWith("@")) || null;
    const name = userLines.find(line => !line.startsWith("@") && line !== "·") || null;
    const texts = Array.from(article.querySelectorAll('[data-testid="tweetText"]'))
      .map(node => clean(node.textContent))
      .filter(Boolean);
    const media = mediaFor(article);

    if (!texts[0] && media.length === 0) {
      return { error: `X source item ${idMatch[1]} has neither text nor media` };
    }

    let quotedPost = null;
    if (texts.length > 1 || times.length > 1) {
      const quotedAnchor = times[1] && times[1].closest('a[href*="/status/"]');
      quotedPost = {
        author: null,
        text: texts[1] || null,
        url: canonicalStatusURL(quotedAnchor && quotedAnchor.getAttribute("href"))
      };
    }

    return {
      record: {
        id: idMatch[1],
        url,
        author: { name, handle },
        text: texts[0] || null,
        createdAt: (times[0] && times[0].getAttribute("datetime")) || null,
        media,
        quotedPost
      }
    };
  }

  function probe() {
    const pageProblem = currentPageProblem();
    if (pageProblem) return pageProblem;
    const pageStructureProblem = structureProblem();
    if (pageStructureProblem) return pageStructureProblem;
    return {
      status: "ready",
      sourceAccount: sourceAccount(),
      collectionID: "likes",
      diagnostics: pageDiagnostics({
        visibleArticleCount: document.querySelectorAll('article[data-testid="tweet"]').length
      })
    };
  }

  function collect(request) {
    const pageProblem = currentPageProblem();
    if (pageProblem) return pageProblem;
    const pageStructureProblem = structureProblem();
    if (pageStructureProblem) return pageStructureProblem;
    if (request.collectionID !== "likes") {
      throw new Error('X Likes collect requires collectionID "likes"');
    }
    if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1)) {
      throw new Error("X Likes collect limit must be a positive integer");
    }

    const showMoreControls = Array.from(
      document.querySelectorAll('article[data-testid="tweet"] [data-testid="tweet-text-show-more-link"]')
    );
    if (showMoreControls.length > 0) {
      for (const control of showMoreControls) control.click();
      return {
        status: "ready",
        sourceAccount: sourceAccount(),
        collectionID: "likes",
        next: { kind: "wait", milliseconds: 150 },
        diagnostics: pageDiagnostics({
          observation: "expanded truncated visible posts before extraction",
          expandedControlCount: showMoreControls.length
        })
      };
    }

    const records = [];
    const seen = new Set();
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (isPromoted(article)) continue;
      const result = recordFor(article);
      if (result.error) {
        return {
          status: "sourceStructureChanged",
          diagnostics: pageDiagnostics({ invariant: result.error })
        };
      }
      if (!seen.has(result.record.id)) {
        seen.add(result.record.id);
        records.push(result.record);
      }
    }

    const limit = request.limit === undefined ? records.length : request.limit;
    const batch = records.slice(0, limit);
    const root = document.documentElement;
    const atBottom = window.scrollY + window.innerHeight >= root.scrollHeight - 4;
    const diagnostics = pageDiagnostics({
      visibleArticleCount: document.querySelectorAll('article[data-testid="tweet"]').length,
      progressIndicatorCount: document.querySelectorAll('[role="progressbar"]').length,
      scrollY: window.scrollY,
      scrollHeight: root.scrollHeight,
      viewportHeight: window.innerHeight,
      atBottom
    });

    if (batch.length === 0) {
      return {
        status: "endUnconfirmed",
        sourceAccount: sourceAccount(),
        collectionID: "likes",
        next: { kind: atBottom ? "wait" : "scroll", ...(atBottom ? { milliseconds: 700 } : { deltaViewportRatio: 0.82 }) },
        diagnostics: Object.assign(diagnostics, {
          invariant: "a single X DOM observation cannot prove collection exhaustion"
        })
      };
    }

    return {
      status: "batch",
      sourceAccount: sourceAccount(),
      collectionID: "likes",
      records: batch,
      next: { kind: "scroll", deltaViewportRatio: 0.82 },
      diagnostics
    };
  }

  function run(request) {
    if (!request || typeof request !== "object") {
      throw new Error("X Likes plugin request must be an object");
    }
    if (request.operation === "describe") {
      return { status: "ready", manifest };
    }
    if (request.operation === "probe") return probe();
    if (request.operation === "collect") return collect(request);
    if (request.operation === "detail") {
      return {
        status: "ready",
        diagnostics: {
          operation: "detail",
          supported: false,
          reason: "X Likes records are complete in the collection timeline; detail navigation is not required"
        }
      };
    }
    throw new Error(`unsupported X Likes plugin operation: ${String(request.operation)}`);
  }

  globalThis.eison.registerPlugin({ manifest, run });
})();
