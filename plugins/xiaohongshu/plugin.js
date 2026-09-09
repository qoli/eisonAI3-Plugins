(function () {
  "use strict";

  const manifest = Object.freeze({
    id: "xiaohongshu",
    displayName: "小紅書",
    protocolVersion: 0,
    revision: "draft-0.3.0",
    loginURL: "https://www.xiaohongshu.com/website-login",
    collections: [
      { id: "favorites", displayName: "收藏", kind: "favorite" },
      { id: "liked", displayName: "點讚", kind: "like" }
    ],
    capabilities: {
      sourceSavedAt: false,
      resumableCursor: true,
      detailNavigation: true,
      orderedMedia: true
    }
  });

  const COLLECTIONS = Object.freeze({
    favorites: { activeText: "收藏", tab: "fav", sourceMarker: "pc_collect" },
    liked: { activeText: "点赞", tab: "liked", sourceMarker: "pc_like" }
  });
  const SOURCE_ORIGIN = "https://www.xiaohongshu.com";
  const END_TEXTS = new Set(["没有更多了", "沒有更多了", "已经到底了", "已經到底了", "到底了"]);
  const EMPTY_TEXTS = Object.freeze({
    favorites: new Set(["暂无收藏", "暫無收藏", "还没有收藏", "還沒有收藏"]),
    liked: new Set(["暂无点赞", "暫無點讚", "还没有点赞", "還沒有點讚"])
  });

  function clean(value) {
    if (value == null) return null;
    const result = String(value).replace(/\s+/g, " ").trim();
    return result || null;
  }

  function diagnostics(code, values) {
    return { code, ...values };
  }

  function currentURL() {
    try {
      return new URL(globalThis.location.href);
    } catch (error) {
      return null;
    }
  }

  function visibleText(selector) {
    return [...document.querySelectorAll(selector)]
      .map(node => clean(node.textContent))
      .filter(Boolean);
  }

  function loginEvidence(url) {
    if (url.pathname.includes("/login") || url.pathname.includes("/website-login")) return "loginURL";
    const text = visibleText(".login-container, .login-modal, [class*='login']").join(" ");
    if (/登录|登入|扫码登录|手機號登錄/.test(text)) return "loginUI";
    return null;
  }

  function verificationEvidence(url) {
    const errorCode = url.searchParams.get("error_code");
    if (errorCode) return `errorCode:${errorCode}`;
    const text = visibleText(".captcha, [class*='captcha'], [class*='verify'], [class*='risk']").join(" ");
    if (/验证|驗證|安全校验|访问异常|操作频繁/.test(text)) return "verificationUI";
    return null;
  }

  function pageGate() {
    const url = currentURL();
    if (!url) {
      return { status: "sourceStructureChanged", diagnostics: diagnostics("invalidPageURL", {}) };
    }
    if (url.origin !== SOURCE_ORIGIN) {
      return {
        status: "needsUserVerification",
        diagnostics: diagnostics("wrongOrigin", { currentOrigin: url.origin, expectedOrigin: SOURCE_ORIGIN })
      };
    }
    const verification = verificationEvidence(url);
    if (verification) {
      return { status: "needsUserVerification", diagnostics: diagnostics("verificationRequired", { evidence: verification }) };
    }
    const login = loginEvidence(url);
    if (login) {
      return { status: "needsLogin", diagnostics: diagnostics("loginRequired", { evidence: login }) };
    }
    return { url };
  }

  function requestedCollection(request) {
    if (typeof request.collectionID !== "string" || !COLLECTIONS[request.collectionID]) return null;
    return request.collectionID;
  }

  function activeCollection() {
    const activeText = clean(document.querySelector(".reds-tab-item.active.sub-tab-list")?.textContent);
    const entry = Object.entries(COLLECTIONS).find(([, value]) => value.activeText === activeText);
    return entry ? { id: entry[0], activeText } : { id: null, activeText };
  }

  function profileIdentity(url) {
    const match = url.pathname.match(/^\/user\/profile\/([^/]+)\/?$/);
    if (!match) return null;
    const displayName = clean(
      document.querySelector(".user-name, .username, .user-basic .name, [class*='user-name']")?.textContent
    );
    return { id: decodeURIComponent(match[1]), displayName };
  }

  function validateSourcePage(request) {
    const gate = pageGate();
    if (gate.status) return gate;
    const collectionID = requestedCollection(request);
    if (!collectionID) {
      return {
        status: "needsUserVerification",
        diagnostics: diagnostics("collectionRequired", { supportedCollectionIDs: Object.keys(COLLECTIONS) })
      };
    }
    const account = profileIdentity(gate.url);
    if (!account) {
      return {
        status: "needsUserVerification",
        collectionID,
        diagnostics: diagnostics("profilePageRequired", { currentPath: gate.url.pathname })
      };
    }
    const active = activeCollection();
    if (!active.id) {
      const hasProfileShell = Boolean(document.querySelector(".user-page, .user-container, .feeds-container"));
      return {
        status: hasProfileShell ? "sourceStructureChanged" : "needsUserVerification",
        collectionID,
        diagnostics: diagnostics("activeCollectionUnknown", { activeText: active.activeText })
      };
    }
    if (active.id !== collectionID) {
      return {
        status: "needsUserVerification",
        collectionID,
        sourceAccount: account,
        diagnostics: diagnostics("wrongCollectionActive", { requestedCollectionID: collectionID, activeCollectionID: active.id })
      };
    }
    return { url: gate.url, collectionID, collection: COLLECTIONS[collectionID], account };
  }

  function normalizeCursor(cursor) {
    if (cursor === undefined) return { seenIDs: [], signature: null, stableBottomReads: 0 };
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    if (!Array.isArray(cursor.seenIDs) || cursor.seenIDs.some(id => typeof id !== "string" || !id)) return null;
    if (cursor.signature !== null && typeof cursor.signature !== "string") return null;
    if (!Number.isInteger(cursor.stableBottomReads) || cursor.stableBottomReads < 0) return null;
    return {
      seenIDs: [...new Set(cursor.seenIDs)],
      signature: cursor.signature,
      stableBottomReads: cursor.stableBottomReads
    };
  }

  function mediaFromImage(image, itemID) {
    const url = clean(image.currentSrc || image.src || image.getAttribute("src"));
    if (!url) throw new Error(`note ${itemID} cover image URL is missing`);
    const width = Number(image.naturalWidth || image.getAttribute("width"));
    const height = Number(image.naturalHeight || image.getAttribute("height"));
    const media = { type: "image", url, order: 0 };
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      media.width = width;
      media.height = height;
      media.aspectRatio = width / height;
    }
    return media;
  }

  function parseCards(collection) {
    const cards = [...document.querySelectorAll(".feeds-container section.note-item[data-note-id]")];
    const records = [];
    for (const card of cards) {
      try {
        const id = clean(card.dataset.noteId);
        const cover = card.querySelector("a.cover");
        const image = cover?.querySelector("img");
        const author = card.querySelector("a.author");
        const authorName = clean(author?.textContent);
        if (!id || !cover?.href || !image || !authorName || !author?.href) {
          return { error: diagnostics("malformedNoteCard", { itemID: id }) };
        }
        const authorURL = new URL(author.href, location.href);
        if (authorURL.searchParams.get("xsec_source") !== collection.sourceMarker) {
          return {
            error: diagnostics("collectionSourceMarkerMismatch", {
              itemID: id,
              expectedMarker: collection.sourceMarker,
              actualMarker: authorURL.searchParams.get("xsec_source")
            })
          };
        }
        const detailURL = new URL(cover.href, location.href);
        if (detailURL.origin !== SOURCE_ORIGIN || !detailURL.pathname.startsWith(`/explore/${id}`)) {
          return { error: diagnostics("invalidDetailURL", { itemID: id, detailURL: detailURL.href }) };
        }
        records.push({
          id,
          canonicalURL: `${detailURL.origin}${detailURL.pathname}`,
          detailURL: detailURL.href,
          author: { name: authorName, profileURL: `${authorURL.origin}${authorURL.pathname}` },
          title: clean(card.querySelector("a.title")?.textContent),
          text: null,
          sourceSavedAt: null,
          media: [mediaFromImage(image, id)]
        });
      } catch (error) {
        return { error: diagnostics("malformedNoteCard", { message: String(error?.message || error) }) };
      }
    }
    return { cards, records };
  }

  function pageProgress() {
    const root = document.documentElement;
    const scrollY = Number(globalThis.scrollY || 0);
    const viewportHeight = Number(globalThis.innerHeight || 0);
    const scrollHeight = Number(root?.scrollHeight || 0);
    return {
      scrollY,
      viewportHeight,
      scrollHeight,
      atBottom: scrollHeight > 0 && scrollY + viewportHeight >= scrollHeight - 4,
      progressIndicatorCount: document.querySelectorAll('[role="progressbar"], .loading, [class*="loading"]').length
    };
  }

  function explicitTerminalEvidence(collectionID) {
    const texts = visibleText(".end-container, .feeds-end, [class*='end'], .empty, [class*='empty']");
    const endText = texts.find(text => END_TEXTS.has(text));
    const emptyText = texts.find(text => EMPTY_TEXTS[collectionID].has(text));
    return endText ? { kind: "endMarker", text: endText } : emptyText ? { kind: "emptyMarker", text: emptyText } : null;
  }

  function probe(request) {
    const state = validateSourcePage(request);
    if (state.status) return state;
    const feed = document.querySelector(".feeds-container");
    const progress = pageProgress();
    const terminal = explicitTerminalEvidence(state.collectionID);
    if (!feed && !progress.progressIndicatorCount && !terminal) {
      return {
        status: "sourceStructureChanged",
        collectionID: state.collectionID,
        sourceAccount: state.account,
        diagnostics: diagnostics("feedContainerMissing", { currentPath: state.url.pathname })
      };
    }
    return {
      status: "ready",
      collectionID: state.collectionID,
      sourceAccount: state.account,
      diagnostics: diagnostics("sourcePageVerified", {
        activeText: state.collection.activeText,
        cardCount: document.querySelectorAll(".feeds-container section.note-item[data-note-id]").length,
        loading: progress.progressIndicatorCount > 0,
        terminalEvidence: terminal
      })
    };
  }

  function collect(request) {
    const state = validateSourcePage(request);
    if (state.status) return state;
    const cursor = normalizeCursor(request.cursor);
    if (!cursor) {
      return {
        status: "sourceStructureChanged",
        collectionID: state.collectionID,
        diagnostics: diagnostics("invalidCursor", {})
      };
    }
    const limit = request.limit === undefined ? 50 : request.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return {
        status: "sourceStructureChanged",
        collectionID: state.collectionID,
        diagnostics: diagnostics("invalidLimit", { limit })
      };
    }
    const parsed = parseCards(state.collection);
    if (parsed.error) {
      return {
        status: "sourceStructureChanged",
        collectionID: state.collectionID,
        sourceAccount: state.account,
        diagnostics: parsed.error
      };
    }
    const seen = new Set(cursor.seenIDs);
    const newRecords = parsed.records.filter(record => !seen.has(record.id)).slice(0, limit);
    for (const record of newRecords) seen.add(record.id);
    const signature = parsed.records.map(record => record.id).join(",");
    const progress = pageProgress();
    const terminal = explicitTerminalEvidence(state.collectionID);
    const stableBottomReads = terminal && progress.atBottom && progress.progressIndicatorCount === 0
      ? cursor.signature === signature ? cursor.stableBottomReads + 1 : 1
      : 0;
    const nextCursor = { seenIDs: [...seen], signature, stableBottomReads };

    if (newRecords.length > 0) {
      return {
        status: "batch",
        collectionID: state.collectionID,
        sourceAccount: state.account,
        records: newRecords,
        cursor: nextCursor,
        next: { kind: "scroll", target: "feedBottom" },
        diagnostics: diagnostics("visibleBatchCollected", { visibleCardCount: parsed.cards.length, newRecordCount: newRecords.length })
      };
    }
    if (terminal && progress.atBottom && progress.progressIndicatorCount === 0 && stableBottomReads >= 2) {
      return {
        status: "endConfirmed",
        collectionID: state.collectionID,
        sourceAccount: state.account,
        cursor: nextCursor,
        diagnostics: diagnostics("explicitStableEnd", { terminalEvidence: terminal, stableBottomReads })
      };
    }
    return {
      status: "endUnconfirmed",
      collectionID: state.collectionID,
      sourceAccount: state.account,
      cursor: nextCursor,
      next: { kind: progress.progressIndicatorCount > 0 ? "wait" : "scroll", target: "feedBottom" },
      diagnostics: diagnostics("noNewVisibleRecords", {
        visibleCardCount: parsed.cards.length,
        atBottom: progress.atBottom,
        progressIndicatorCount: progress.progressIndicatorCount,
        terminalEvidence: terminal,
        stableBottomReads
      })
    };
  }

  function detail(request) {
    const gate = pageGate();
    if (gate.status) return gate;
    if (typeof request.sourceItemID !== "string" || !request.sourceItemID) {
      return { status: "sourceStructureChanged", diagnostics: diagnostics("sourceItemIDRequired", {}) };
    }
    if (gate.url.pathname === "/404" || gate.url.searchParams.get("error_code")) {
      return {
        status: "needsUserVerification",
        diagnostics: diagnostics("detailUnavailable", { currentPath: gate.url.pathname, errorCode: gate.url.searchParams.get("error_code") })
      };
    }
    if (gate.url.pathname !== `/explore/${request.sourceItemID}`) {
      return {
        status: "needsUserVerification",
        diagnostics: diagnostics("wrongDetailPage", { expectedPath: `/explore/${request.sourceItemID}`, currentPath: gate.url.pathname })
      };
    }
    const container = document.querySelector("#noteContainer");
    const titleElement = document.querySelector("#detail-title");
    const descriptionElement = document.querySelector("#detail-desc");
    if (!container || !titleElement || !descriptionElement) {
      return {
        status: "sourceStructureChanged",
        diagnostics: diagnostics("detailDOMMissing", {
          hasContainer: Boolean(container),
          hasTitleElement: Boolean(titleElement),
          hasDescriptionElement: Boolean(descriptionElement)
        })
      };
    }
    const renderedTitle = clean(titleElement?.textContent);
    if (!renderedTitle) {
      return {
        status: "sourceStructureChanged",
        diagnostics: diagnostics("detailTitleMissing", {})
      };
    }
    const video = container.querySelector("video");
    const media = [];
    if (video) {
      const videoURL = clean(video.currentSrc || video.src || video.getAttribute("src"));
      if (!videoURL) {
        return {
          status: "sourceStructureChanged",
          diagnostics: diagnostics("videoSourceMissing", {})
        };
      }
      media.push({ type: "video", url: videoURL, order: 0 });
    } else {
      const images = [...container.querySelectorAll(".swiper-slide img, img.note-slider-img, .carousel-container img")];
      const seenURLs = new Set();
      for (const image of images) {
        const url = clean(image.currentSrc || image.src || image.getAttribute("src"));
        if (!url || seenURLs.has(url)) continue;
        seenURLs.add(url);
        const width = Number(image.naturalWidth || image.getAttribute("width"));
        const height = Number(image.naturalHeight || image.getAttribute("height"));
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
          return {
            status: "sourceStructureChanged",
            diagnostics: diagnostics("invalidDetailImageDimensions", { index: media.length, url })
          };
        }
        media.push({ type: "image", url, width, height, aspectRatio: width / height, order: media.length });
      }
    }
    if (media.length === 0) {
      return {
        status: "sourceStructureChanged",
        diagnostics: diagnostics("detailMediaMissing", {})
      };
    }
    const noteType = video ? "video" : "normal";
    return {
      status: "batch",
      records: [{
        id: request.sourceItemID,
        canonicalURL: `${gate.url.origin}${gate.url.pathname}`,
        title: renderedTitle,
        text: clean(descriptionElement.querySelector(".note-text")?.textContent ?? descriptionElement.textContent),
        noteType,
        sourceSavedAt: null,
        media
      }],
      diagnostics: diagnostics("detailCollected", { mediaCount: media.length, noteType })
    };
  }

  function run(request) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return { status: "sourceStructureChanged", diagnostics: diagnostics("invalidRequest", {}) };
    }
    switch (request.operation) {
      case "describe":
        return { status: "ready", manifest };
      case "probe":
        return probe(request);
      case "collect":
        return collect(request);
      case "detail":
        return detail(request);
      default:
        return {
          status: "sourceStructureChanged",
          diagnostics: diagnostics("unsupportedOperation", { operation: request.operation ?? null })
        };
    }
  }

  globalThis.eison.registerPlugin({ manifest, run });
}());
