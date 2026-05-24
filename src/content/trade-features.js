/**
 * BtrKorone - Trade Modal Enhancement (Rex tier)
 *
 * RoPro-style enhancement injected directly into Pekora's trade modal.
 *
 * Per-item card:
 *   - Top-right Robux pill badge with Korone value (or RAP fallback)
 *   - Color-coded demand dot
 *
 * Per-section (under each "Value: R$ XXX"):
 *   - Korone Rolimons Value (sum of Koromons.Value for each item)
 *   - Korone Demand Rating (X.X / 5.0)
 *
 * Between the two sections:
 *   - Net change indicator: green ↑ +N (X%) for profit, red ↓ -N (-X%) for loss
 *
 * Uses Pekora's trade API (credentials:include) for real data.
 */

(function BtrTradeModalFeature() {
  "use strict";

  const TRADE_PAGES = ["/My/Trades.aspx", "/My/Trades", "/trades"];
  // Pekora serves item thumbs from several paths. Match permissively then let
  // findCardAnchor's size heuristic filter out non-item images (avatars, etc).
  const THUMB_SRC_RX = /\/(images\/thumbnails|thumbnails|asset-thumbnail|item-thumbnail|asset)\//i;

  // ============================================================
  // MINIMAL MODE
  // ------------------------------------------------------------
  // When true, we don't surgically modify Pekora's modal DOM (no per-card
  // pills, no section summary rows, no net-change indicator wedged between
  // sections). Instead we append a single self-contained "Trade Analysis"
  // panel near the modal footer. This guarantees we don't break Pekora's
  // layout while still surfacing the verdict + values + demand.
  //
  // Set to false (or build a popup toggle) to re-enable the RoPro-style
  // full injection once the layout interaction is sorted out.
  // ============================================================
  // 2.4.5: surgical injection re-enabled. Per-item bottom-left value badges
  // + a centered ↑/↓ percentage between sections, RoPro-style. The bottom
  // side-by-side panel still renders as a graceful fallback if Pekora's
  // markup ever shifts and the give/receive headings can't be found.
  const MINIMAL_MODE = false;

  // Demand string -> 1-5 numeric rating
  const DEMAND_RATING = {
    "Very High": 5,
    "High":      4,
    "Medium":    3,
    "Low":       2,
    "Very Low":  1
  };

  let cachedMyUserId = null;
  let cachedTrades = [];
  // Per-modal stamping replaces the old global injectedTradeKey: we tag the
  // modal element itself with `data-btrk-trade-id="<id>"` once enhanced, so
  // dedup state lives with the DOM and survives rapid close/open cycles
  // and click-different-trade flows. The only global state we need is a
  // re-entry guard for in-flight async work on a particular modal element.
  let pendingResolveModal = null;

  // Trade ID hint captured from the user's most recent click. The "View
  // Details" link / button on a trade row almost always embeds the trade
  // ID in onclick / href / data-* attributes; capturing it on click is far
  // more reliable than trying to scrape the modal afterwards.
  let lastTradeHint = { id: null, ts: 0 };
  // Full trade detail captured by the page-spy when Pekora itself fetched it.
  // Lets us skip our own refetch + cache lookup entirely.
  let lastTradeDetail = { id: null, detail: null, ts: 0 };
  const HINT_TTL_MS = 8000;

  function isTradePage() {
    return TRADE_PAGES.some(p => window.location.pathname.toLowerCase().includes(p.toLowerCase()));
  }

  /**
   * Listen for trade-id hints AND full trade-detail payloads relayed from
   * the page-spy script. The spy intercepts Pekora's own
   * /apisite/trades/v1/trades/{id} fetch and posts both the trade ID
   * (immediately on URL match) and, when the response arrives, the full
   * parsed JSON. Using the cached detail lets us skip our own refetch.
   */
  function installFetchSpyListener() {
    window.addEventListener("message", (event) => {
      // Only accept messages from this exact window (the page itself)
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__btrkorone !== true) return;

      if (data.type === "TRADE_FETCH") {
        const raw = String(data.tradeId || "");
        if (!/^\d{3,12}$/.test(raw)) return;
        // A new trade is being fetched - if the cached detail belongs to a
        // different trade, drop it immediately so we never paint trade A's
        // values into trade B's modal in the gap between FETCH and DETAIL.
        if (lastTradeDetail.id && lastTradeDetail.id !== raw) {
          lastTradeDetail = { id: null, detail: null, ts: 0 };
        }
        lastTradeHint = { id: raw, ts: Date.now() };
        console.log(`[BtrKorone/Trades] Fetch spy captured trade ID: ${raw}`);
        return;
      }

      if (data.type === "TRADE_DETAIL" && data.detail) {
        const raw = String(data.tradeId || "");
        if (!/^\d{3,12}$/.test(raw)) return;
        lastTradeDetail = { id: raw, detail: data.detail, ts: Date.now() };
        // The hint is cheaper to use elsewhere too
        lastTradeHint = { id: raw, ts: Date.now() };
        console.log(`[BtrKorone/Trades] Spy captured full detail for trade ${raw}`);
        // Don't enhance directly here - let the MutationObserver fire
        // tryEnhanceVisibleModal once the modal DOM is actually present.
      }
    });
  }

  /**
   * Inject the page-spy script tag into the page's main world as a fallback
   * for browsers / setups where world:"MAIN" content_scripts don't load.
   * The spy itself self-guards against double-installation.
   */
  function injectPageSpyFallback() {
    try {
      if (window.__btrkPageSpyInstalled) return; // MAIN-world load already won
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("content/page-spy.js");
      s.async = false;
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      console.warn("[BtrKorone/Trades] Could not inject page-spy fallback:", e);
    }
  }

  /**
   * Install a capture-phase click listener that scans the clicked element
   * (and a few ancestors) for anything that looks like a trade ID.
   */
  function installClickHintCapture() {
    document.addEventListener("click", (e) => {
      let el = e.target;
      for (let depth = 0; depth < 6 && el && el.nodeType === 1; depth++) {
        const out = (el.outerHTML || "").slice(0, 2000);
        // Match common shapes:
        //   data-trade-id="12345" / tradeid:12345 / trade=12345
        //   ?id=12345 / &tradeid=12345 / /trades/12345
        //   ShowTradeDetails(12345) / OpenTrade(12345)
        const patterns = [
          /(?:tradeid|trade[_-]?id|data-trade|data-id)\s*[="':\s]+(\d{4,10})/i,
          /[?&](?:id|tradeid|trade)=(\d{4,10})/i,
          /\/trades?\/(\d{4,10})/i,
          /(?:ShowTrade|OpenTrade|ViewTrade)[^(]*\(\s*['"]?(\d{4,10})['"]?\s*[,)]/i
        ];
        for (const rx of patterns) {
          const m = out.match(rx);
          if (m) {
            lastTradeHint = { id: m[1], ts: Date.now() };
            console.log(`[BtrKorone/Trades] Click captured trade ID hint: ${m[1]}`);
            return;
          }
        }
        el = el.parentElement;
      }
    }, /* useCapture = */ true);
  }

  // ============================================================
  // INIT
  // ============================================================

  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);
    // This script handles two related features that share the same
    // modal-detection plumbing:
    //   - tradeModal (Rex)        -> per-item value pill + section summary + verdict banner
    //   - koromonsBadges (Plus)   -> just the small Koromons gem indicator on tracked items
    // If neither is active there's nothing to do.
    if (
      !window.__btrkorone.hasFeature("tradeModal") &&
      !window.__btrkorone.hasFeature("koromonsBadges")
    ) return;
    if (!isTradePage()) return;
    init();
  }, 100);

  async function init() {
    if (typeof KoromonsAPI !== "undefined") await KoromonsAPI.load();

    if (typeof PekoraAPI !== "undefined") {
      const me = await PekoraAPI.getAuthenticatedUser();
      if (me) cachedMyUserId = me.id;
    }
    if (!cachedMyUserId) {
      try {
        const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
        if (status && status.userId) cachedMyUserId = Number(status.userId);
      } catch (e) {}
    }
    if (!cachedMyUserId) {
      console.warn("[BtrKorone/Trades] Could not determine current user ID");
      return;
    }

    console.log("[BtrKorone/Trades] Init for user:", cachedMyUserId);
    installFetchSpyListener();
    injectPageSpyFallback();
    installClickHintCapture();
    await refreshTradeCache();
    observeForTradeModal();
  }

  async function refreshTradeCache() {
    if (typeof PekoraAPI === "undefined") return;
    try {
      // Completed trades are needed for the "View Details" modal opened from
      // the Completed tab - inbound/outbound alone won't contain them.
      const [inb, outb, comp] = await Promise.all([
        PekoraAPI.getInboundTrades(),
        PekoraAPI.getOutboundTrades(),
        PekoraAPI.getCompletedTrades()
      ]);
      cachedTrades = [
        ...((inb  && inb.data)  || []),
        ...((outb && outb.data) || []),
        ...((comp && comp.data) || [])
      ];
      console.log(
        `[BtrKorone/Trades] Cached ${cachedTrades.length} trades ` +
        `(inbound: ${(inb && inb.data && inb.data.length) || 0}, ` +
        `outbound: ${(outb && outb.data && outb.data.length) || 0}, ` +
        `completed: ${(comp && comp.data && comp.data.length) || 0})`
      );
    } catch (e) {
      console.warn("[BtrKorone/Trades] Could not pre-fetch trades:", e);
    }
  }

  // ============================================================
  // MODAL DETECTION
  // ============================================================

  function observeForTradeModal() {
    const observer = new MutationObserver(() => tryEnhanceVisibleModal());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    tryEnhanceVisibleModal();
  }

  async function tryEnhanceVisibleModal() {
    const modal = findVisibleTradeModal();
    if (!modal) {
      pendingResolveModal = null;
      return;
    }

    // Wait for the modal to finish its open-animation. Pekora's modal grows
    // from a small rect; measuring DOM positions mid-animation produces
    // wrong card anchors and net-change placement. The MutationObserver
    // will fire again once the rect settles and we'll retry then.
    const rect = modal.getBoundingClientRect();
    if (rect.width < 300 || rect.height < 200) return;

    // Re-entry guard: don't kick off a second async resolve for the SAME
    // modal element while one is in flight.
    if (pendingResolveModal === modal) return;

    // Identity-based dedup: the stamp lives on the modal element itself, so
    // it can't collide with other trades' modal keys, can't get stuck in a
    // global, and is automatically gone when Pekora removes the modal.
    const stamped = modal.dataset.btrkTradeId || null;

    // Pick the freshest trade ID we have. The hint is bumped on every
    // TRADE_FETCH, the detail only after TRADE_DETAIL completes - so if
    // detail.id !== hint.id, the detail is stale (a newer trade is being
    // resolved) and we must NOT use it.
    const hintFresh   = lastTradeHint.id   && (Date.now() - lastTradeHint.ts   < HINT_TTL_MS);
    const detailFresh = lastTradeDetail.detail
                     && lastTradeDetail.id === lastTradeHint.id
                     && (Date.now() - lastTradeDetail.ts < HINT_TTL_MS);

    let tradeId = null;
    let detail  = null;
    if (detailFresh) {
      tradeId = lastTradeDetail.id;
      detail  = lastTradeDetail.detail;
    } else if (hintFresh) {
      tradeId = lastTradeHint.id;
    }

    // Already correctly enhanced for the current trade - nothing to do.
    if (stamped && tradeId && stamped === tradeId) return;

    pendingResolveModal = modal;
    try {
      if (!detail) {
        tradeId = tradeId || await resolveTradeIdFromModal(modal);
        if (!tradeId) {
          // Don't stamp - the next mutation will retry once we have data.
          console.log("[BtrKorone/Trades] Modal open but couldn't resolve trade ID yet; will retry.");
          return;
        }
        console.log(`[BtrKorone/Trades] Resolved trade ID: ${tradeId}`);

        detail = await PekoraAPI.getTradeDetail(tradeId);
        if (!detail) {
          console.warn(`[BtrKorone/Trades] getTradeDetail(${tradeId}) returned null`);
          return;
        }
      } else {
        console.log(`[BtrKorone/Trades] Using spy-cached detail for trade ${tradeId}`);
      }

      // Idempotent: wipe any prior injection on this modal element before
      // re-rendering. Handles two cases cleanly:
      //   1. Pekora reused the modal DOM with different content (different
      //      trade) - we tear down trade A's markers before drawing B's.
      //   2. A previous attempt landed mid-animation and produced a partial
      //      / misplaced render - we redo it now that the modal is stable.
      clearInjections(modal);
      enhanceModal(modal, detail);

      // Stamp success so subsequent mutation fires for the same trade are
      // a no-op.
      modal.dataset.btrkTradeId = String(tradeId);
    } finally {
      pendingResolveModal = null;
    }
  }

  /**
   * Remove every element this feature injects into a trade modal. Used
   * before re-rendering so we never stack stale markers from a previous
   * trade or a partial earlier attempt.
   */
  function clearInjections(modal) {
    modal.querySelectorAll(
      ".btrkorone-value-badge, .btrkorone-koromons-badge, .btrk-net-change, .btrk-section-summary, .btrk-trade-summary-panel"
    ).forEach(el => el.remove());
  }

  function findVisibleTradeModal() {
    // Strategy 1: standard modal selectors
    const candidates = document.querySelectorAll(
      ".modal.show, .modal.in, .modal-content, [role='dialog'], .trade-modal, .modal-dialog"
    );
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = (el.textContent || "").toLowerCase();
      if (text.includes("trade request") ||
          text.includes("items you will give") ||
          text.includes("items you will receive") ||
          text.includes("items you gave") ||
          text.includes("items you received")) {
        return el.closest(".modal-content") || el.closest(".modal") || el;
      }
    }

    // Strategy 2: fallback - Pekora may use a custom (non-Bootstrap) modal.
    // Walk up from any visible "items you will give/gave" heading until we
    // find a container that ALSO holds the receive heading.
    const giveHeading =
      findElementContainingText("items you will give") ||
      findElementContainingText("items you gave");
    if (giveHeading) {
      let el = giveHeading;
      for (let i = 0; i < 12 && el && el.parentElement; i++) {
        const t = (el.textContent || "").toLowerCase();
        const rect = el.getBoundingClientRect();
        if (rect.width >= 280 &&
            (t.includes("items you will receive") || t.includes("items you received"))) {
          return el;
        }
        el = el.parentElement;
      }
    }

    return null;
  }

  /**
   * Walk text nodes to find the element whose text contains a phrase.
   * Returns the smallest matching parent element, not the document body.
   */
  function findElementContainingText(phrase) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.textContent || "").toLowerCase();
      if (t.length < 200 && t.includes(phrase)) {
        return node.parentElement;
      }
    }
    return null;
  }

  function generateModalKey(modal) {
    // Retained for diagnostic logs only - dedup now uses a per-modal data
    // attribute (see tryEnhanceVisibleModal). Returns a short fingerprint
    // of the visible item names so console messages remain useful.
    const names = [...modal.querySelectorAll("a, .item-name, .text-truncate")]
      .map(el => el.textContent.trim())
      .filter(s => s.length > 2 && s.length < 80)
      .join("|");
    return names.substring(0, 200);
  }

  async function resolveTradeIdFromModal(modal) {
    // 1. Click hint - the most reliable signal. The user just clicked a
    //    "View Details" element that almost always carries the trade ID.
    if (lastTradeHint.id && Date.now() - lastTradeHint.ts < HINT_TTL_MS) {
      console.log(`[BtrKorone/Trades] Resolve via click hint: ${lastTradeHint.id}`);
      return lastTradeHint.id;
    }

    // 2. Explicit data attributes on or inside the modal
    const dataEl = modal.querySelector("[data-trade-id], [data-tradeid], [data-id]");
    if (dataEl) {
      const id =
        dataEl.dataset.tradeId ||
        dataEl.dataset.tradeid ||
        dataEl.dataset.id;
      if (id && /^\d{4,10}$/.test(id)) {
        console.log(`[BtrKorone/Trades] Resolve via data-attr: ${id}`);
        return id;
      }
    }

    // 3. Regex over the modal HTML for trade-id shaped substrings
    const html = modal.innerHTML || "";
    const regexes = [
      /(?:tradeid|trade[_-]?id|data-trade|data-id)\s*[="':\s]+(\d{4,10})/i,
      /[?&](?:id|tradeid|trade)=(\d{4,10})/i,
      /\/trades?\/(\d{4,10})/i
    ];
    for (const rx of regexes) {
      const m = html.match(rx);
      if (m) {
        console.log(`[BtrKorone/Trades] Resolve via HTML regex: ${m[1]}`);
        return m[1];
      }
    }

    // 4. Partner-name fallback - look up the trade in cache by partner name
    const partnerName = extractPartnerName(modal);
    console.log(`[BtrKorone/Trades] Extracted partner name: ${partnerName ? `"${partnerName}"` : "(none)"}`);
    if (partnerName) {
      let match = findCachedTradeByPartner(partnerName);
      if (!match) {
        // Refresh cache once and retry - the trade may be newer than our snapshot
        console.log("[BtrKorone/Trades] No cache hit; refreshing cache and retrying.");
        await refreshTradeCache();
        match = findCachedTradeByPartner(partnerName);
      }
      if (match) {
        console.log(`[BtrKorone/Trades] Resolve via cache-lookup: ${match.id}`);
        return String(match.id);
      }
      // Help the user (and us) see why the lookup missed
      const sample = cachedTrades.slice(0, 6)
        .map(t => extractAnyName(t) || "?")
        .join(", ");
      console.log(`[BtrKorone/Trades] Cache miss for "${partnerName}". Sample of cached partner names: [${sample}]`);
    }

    return null;
  }

  /**
   * Look up a cached trade by partner name. The list endpoint's user-field
   * shape is inconsistent across inbound/outbound/completed, so we check
   * every user-shaped slot we can find on each trade row.
   */
  function findCachedTradeByPartner(partnerName) {
    const target = partnerName.toLowerCase();
    return cachedTrades.find(t => {
      const candidates = collectUserNames(t);
      return candidates.some(n => n && n.toLowerCase() === target);
    }) || null;
  }

  function collectUserNames(t) {
    const out = [];
    if (!t) return out;
    const userish = [t.user, t.partner, t.sender, t.recipient, t.from, t.to];
    if (Array.isArray(t.offers)) {
      for (const o of t.offers) {
        if (o && o.user) userish.push(o.user);
      }
    }
    for (const u of userish) {
      if (u && typeof u === "object") {
        if (u.name) out.push(String(u.name));
        if (u.username) out.push(String(u.username));
        if (u.displayName) out.push(String(u.displayName));
      }
    }
    return out;
  }

  function extractAnyName(t) {
    return collectUserNames(t)[0] || null;
  }

  function extractPartnerName(modal) {
    const text = modal.textContent || "";
    const m = text.match(/Trade with\s+([A-Za-z0-9_]+)/i);
    if (m) return m[1];

    const profileLink = modal.querySelector("a[href*='/users/']");
    if (profileLink) {
      const name = (profileLink.textContent || "").trim();
      if (name) return name;
    }
    return null;
  }

  // ============================================================
  // MAIN ENHANCEMENT
  // ============================================================

  function enhanceModal(modal, tradeDetail) {
    const { myOffer, theirOffer } = PekoraAPI.splitTradeOffers(tradeDetail, cachedMyUserId);
    const myCalc    = PekoraAPI.calculateOfferValue(myOffer    ? myOffer.userAssets    : []);
    const theirCalc = PekoraAPI.calculateOfferValue(theirOffer ? theirOffer.userAssets : []);

    // Minimal mode: don't touch Pekora's modal DOM at all - just append a
    // single self-contained verdict panel. Safe by construction.
    if (MINIMAL_MODE) {
      injectFallbackPanel(modal, myCalc, theirCalc);
      return;
    }

    const sections = findSectionHeadings(modal);
    // Need BOTH headings for the inline injection - the percentage indicator
    // is anchored at the boundary between the two subtrees. If either is
    // missing, fall back to the self-contained bottom panel.
    if (!sections.give || !sections.receive) {
      console.warn("[BtrKorone/Trades] Could not locate both give/receive headings; falling back to bottom panel.");
      injectFallbackPanel(modal, myCalc, theirCalc);
      return;
    }

    // 1. Bottom-left value pill on every item frame.
    badgeItemsBetween(modal, sections.give, sections.receive, myCalc.items);
    badgeItemsBetween(modal, sections.receive, null, theirCalc.items);

    // 2. Centered up/down percentage banner between the two sections.
    injectNetChange(modal, sections, myCalc, theirCalc);

    // (Per-section summary rows removed: redundant with Pekora's native
    // "Value: R$ XXX" line + fragile when Pekora's section markup is flat
    // rather than nested. The user gets the deltas via the centered banner
    // and the bottom-panel fallback in unusual layouts.)
  }

  // ============================================================
  // SECTION & CARD DETECTION
  // ============================================================

  function findSectionHeadings(modal) {
    // Pending trades use future tense ("Items you will give/receive"),
    // completed trades use past tense ("Items you gave/received").
    // Match both.
    const walker = document.createTreeWalker(modal, NodeFilter.SHOW_TEXT);
    let give = null, receive = null;
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.textContent || "").toLowerCase().trim();
      if (!t) continue;
      if (!give    && /^items you (will give|gave)\b/.test(t))      give    = node.parentElement;
      else if (!receive && /^items you (will receive|received)\b/.test(t)) receive = node.parentElement;
      if (give && receive) break;
    }
    return { give, receive };
  }

  /**
   * Find item thumbnail images that fall after `start` and before `end`
   * (or all that fall after `start` if `end` is null).
   * Returns an array of {img, card} pairs where card is a sensible parent
   * to anchor a position:absolute badge to.
   */
  function findItemCardsBetween(modal, start, end) {
    const imgs = Array.from(modal.querySelectorAll("img"));
    const results = [];
    for (const img of imgs) {
      const src = img.getAttribute("src") || "";
      if (!THUMB_SRC_RX.test(src)) continue;

      // Position relative to the start heading
      if (start) {
        const pos = start.compareDocumentPosition(img);
        if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      }
      if (end) {
        const pos = end.compareDocumentPosition(img);
        if (!(pos & Node.DOCUMENT_POSITION_PRECEDING)) continue;
      }

      const card = findCardAnchor(img);
      if (card) results.push({ img, card });
    }
    return results;
  }

  /**
   * Walk up from <img> to find the item-frame element to anchor a
   * position:absolute badge to. We combine two signals - DOM structure
   * (the frame's parent should be a row of 3-12 sibling cells, i.e. an
   * items grid) and size sanity (the frame itself should be card-shaped) -
   * so we don't get fooled by mid-animation rects or by random layout
   * containers higher up the tree.
   */
  function findCardAnchor(img) {
    let el = img;
    for (let depth = 0; depth < 6 && el && el.parentElement; depth++) {
      const parent = el.parentElement;
      const sibCount = parent.children.length;
      if (sibCount >= 3 && sibCount <= 12) {
        const rect = el.getBoundingClientRect();
        if (rect.width >= 40 && rect.width <= 250 && rect.height >= 40 && rect.height <= 260) {
          return el;
        }
      }
      el = parent;
    }
    // Fallback: pure size heuristic - preserves backward compat if the
    // grid has an unusual sibling count.
    let f = img.parentElement;
    for (let i = 0; f && i < 4; i++) {
      const r = f.getBoundingClientRect();
      if (r.width >= 40 && r.width <= 200 && r.height >= 40 && r.height <= 220) return f;
      f = f.parentElement;
    }
    return img.parentElement;
  }

  function badgeItemsBetween(modal, start, end, items) {
    const cards = findItemCardsBetween(modal, start, end);
    // Match cards to items in order — Pekora renders items in the same order
    // they come from the trade API (left-to-right).
    cards.forEach((entry, idx) => {
      const item = items[idx];
      if (!item) return;
      addBadgeToCard(entry.card, item);
    });
  }

  function addBadgeToCard(card, item) {
    if (getComputedStyle(card).position === "static") {
      card.style.position = "relative";
    }

    // ---- Plus-tier Koromons gem badge -------------------------------
    // Tagged on every card whose item resolves to a Koromons entry with
    // a Value. Independent of the Rex `tradeModal` feature so a Plus
    // subscriber sees gems even when value pills aren't injected.
    if (
      item && item.hasKoromonValue &&
      window.__btrkorone &&
      window.__btrkorone.hasFeature("koromonsBadges") &&
      !card.querySelector(".btrkorone-koromons-badge")
    ) {
      const gem = document.createElement("div");
      gem.className = "btrkorone-koromons-badge";
      gem.innerHTML =
        '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M6 3 L18 3 L22 9 L12 22 L2 9 Z" fill="#0ea5e9" stroke="#082f49" stroke-width="0.6"/>' +
        '<path d="M6 3 L12 9 L18 3 Z" fill="#7dd3fc"/>' +
        '<path d="M2 9 L22 9 M12 9 L12 22" stroke="#082f49" stroke-width="0.4" fill="none" opacity="0.55"/>' +
        '<circle cx="9" cy="6" r="0.9" fill="#ffffff" opacity="0.9"/>' +
        '</svg>';
      gem.title = `${item.name}\nKoromons Value: ${item.koromonValue.toLocaleString()}`;
      card.appendChild(gem);
    }

    // ---- Rex-tier value pill ----------------------------------------
    // Skip when only `koromonsBadges` is active (Plus tier) - the pill
    // is part of the `tradeModal` feature.
    if (
      !window.__btrkorone ||
      !window.__btrkorone.hasFeature("tradeModal") ||
      card.querySelector(".btrkorone-value-badge")
    ) {
      return;
    }

    const value = item.hasKoromonValue ? item.koromonValue : item.rap;
    const demandColor = item.hasKoromonValue && typeof KoromonsAPI !== "undefined"
      ? KoromonsAPI.getDemandColor(item.demand)
      : null;

    const badge = document.createElement("div");
    badge.className = "btrkorone-value-badge" + (item.hasKoromonValue ? " btrk-valued-live" : " btrk-rap-only");
    badge.innerHTML = `
      <span class="btrk-badge-robux" aria-hidden="true">R$</span>
      <span class="btrk-badge-num">${formatValue(value)}</span>
      ${demandColor ? `<span class="btrk-demand-dot" style="background:${demandColor}"></span>` : ""}
    `;
    badge.title = item.hasKoromonValue
      ? `${item.name}\nKorone Value: ${item.koromonValue.toLocaleString()}\nRAP: ${item.rap.toLocaleString()}\nDemand: ${item.demand}`
      : `${item.name}\nRAP: ${item.rap.toLocaleString()} (no Korone value)`;

    card.appendChild(badge);
  }

  // ============================================================
  // SECTION SUMMARY ROWS
  // ============================================================

  function injectSectionSummary(headingEl, calc, side) {
    const container = findSectionContainer(headingEl);
    if (!container) return;
    if (container.querySelector(`.btrk-section-summary[data-side="${side}"]`)) return;

    const totalKoroneValue = calc.items.reduce(
      (s, i) => s + (i.hasKoromonValue ? i.koromonValue : 0),
      0
    );
    const totalRap = calc.items.reduce((s, i) => s + i.rap, 0);
    const demandRating = computeDemandRating(calc.items);
    const valuedCount = calc.items.filter(i => i.hasKoromonValue).length;

    const summary = document.createElement("div");
    summary.className = "btrk-section-summary";
    summary.dataset.side = side;
    // Pekora already shows "Value: R$ XXX" (RAP) on the native heading line,
    // so we only add what's NEW: the Koromons community Value + demand.
    summary.innerHTML = `
      <div class="btrk-section-row">
        <span class="btrk-section-label">Korone Value:</span>
        <span class="btrk-section-val">
          <span class="btrk-side-icon btrk-icon-koromons" aria-hidden="true">K</span>
          ${valuedCount > 0 ? formatValue(totalKoroneValue) : "&mdash;"}
        </span>
      </div>
      <div class="btrk-section-row">
        <span class="btrk-section-label">Demand:</span>
        <span class="btrk-section-val">
          ${demandRating > 0 ? `${demandRating.toFixed(1)}/5.0` : "&mdash;"}
        </span>
      </div>
    `;
    container.appendChild(summary);
  }

  /**
   * Walk up from a heading element until we find a container that holds
   * both the heading and its item cards (so our summary rows sit beside
   * Pekora's native "Value: R$ XXX" line).
   */
  function findSectionContainer(headingEl) {
    let el = headingEl;
    for (let i = 0; i < 6 && el && el.parentElement; i++) {
      // Heuristic: container has at least one thumbnail img inside
      const hasThumb = Array.from(el.querySelectorAll("img"))
        .some(img => THUMB_SRC_RX.test(img.getAttribute("src") || ""));
      if (hasThumb) return el;
      el = el.parentElement;
    }
    return headingEl.parentElement || headingEl;
  }

  // ============================================================
  // NET CHANGE INDICATOR
  // ============================================================

  /**
   * Walk up from the receive heading until we find the ancestor whose
   * parent also contains the give heading - that ancestor IS the receive
   * subtree, and its previous sibling (or the give subtree) is the give
   * side. Inserting before this anchor lands the percentage banner at the
   * exact give-vs-receive boundary, in both layout shapes:
   *
   * 1. Flat (everything siblings of one container):
   *      <body>
   *        <h2>GIVE</h2>
   *        <div class="grid">...</div>
   *        <h2>RECEIVE</h2>     <-- anchor
   *        <div class="grid">...</div>
   *      </body>
   *
   * 2. Nested (each section in its own wrapper):
   *      <body>
   *        <div class="give-section">...</div>
   *        <div class="receive-section">      <-- anchor
   *          <h2>RECEIVE</h2>
   *          ...
   *        </div>
   *      </body>
   *
   * In both cases the indicator slots in cleanly between the two halves
   * without pushing it to the very top of the items column.
   */
  function findNetChangeAnchor(modal, receiveHeading, giveHeading) {
    if (!receiveHeading || !giveHeading) return receiveHeading;
    let el = receiveHeading;
    for (let depth = 0; depth < 12 && el && el !== modal && el.parentElement; depth++) {
      const parent = el.parentElement;
      if (parent.contains(giveHeading) && !el.contains(giveHeading) && el !== giveHeading) {
        return el;
      }
      el = parent;
    }
    // Should be unreachable for any reasonable modal structure - degrade
    // to the heading itself rather than null so insertion still happens.
    return receiveHeading;
  }

  function injectNetChange(modal, sections, myCalc, theirCalc) {
    // Verdict banner is part of the Rex `tradeModal` feature only.
    if (!window.__btrkorone || !window.__btrkorone.hasFeature("tradeModal")) return;
    const myValue    = effectiveTotal(myCalc);
    const theirValue = effectiveTotal(theirCalc);

    const diff = theirValue - myValue;
    const pct = myValue > 0 ? (diff / myValue) * 100 : 0;

    // Filled triangles read more cleanly than line arrows at small sizes
    // and match the RoPro reference UI.
    let cls = "btrk-net-even", arrow = "\u25B6", sign = "";   // ▶ for even
    if (diff > 0)      { cls = "btrk-net-profit"; arrow = "\u25B2"; sign = "+"; } // ▲
    else if (diff < 0) { cls = "btrk-net-loss";   arrow = "\u25BC"; sign = "";  } // ▼ (formatValue handles minus)

    const indicator = document.createElement("div");
    indicator.className = `btrk-net-change ${cls}`;
    indicator.innerHTML = `
      <span class="btrk-net-inner">
        <span class="btrk-net-arrow">${arrow}</span>
        <span class="btrk-net-value">${sign}${formatValue(diff)}</span>
        <span class="btrk-net-pct">(${sign}${pct.toFixed(0)}%)</span>
      </span>
    `;
    indicator.title = `You give ${formatValue(myValue)} \u2022 You receive ${formatValue(theirValue)}`;

    const anchor = findNetChangeAnchor(modal, sections.receive, sections.give);
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(indicator, anchor);
    }
  }

  function effectiveTotal(calc) {
    // Use Korone value when available, otherwise RAP
    return calc.items.reduce(
      (s, i) => s + (i.hasKoromonValue ? i.koromonValue : i.rap),
      0
    );
  }

  // ============================================================
  // FALLBACK (modal layout couldn't be parsed)
  // ============================================================

  function injectFallbackPanel(modal, myCalc, theirCalc) {
    // Bottom summary panel is part of the Rex `tradeModal` feature only.
    if (!window.__btrkorone || !window.__btrkorone.hasFeature("tradeModal")) return;
    if (modal.querySelector(".btrk-trade-summary-panel")) return;

    // Net diff uses best-available value per item (Korone value when known,
    // else RAP). Mirrors RoPro's headline "you came out N up/down" number.
    const myValue    = effectiveTotal(myCalc);
    const theirValue = effectiveTotal(theirCalc);
    const diff = theirValue - myValue;
    const pct = myValue > 0 ? ((diff / myValue) * 100).toFixed(1) : "0.0";

    let verdictClass = "btrk-verdict-even", arrow = "\u25B6";
    if (diff > 0)      { verdictClass = "btrk-verdict-profit"; arrow = "\u25B2"; }
    else if (diff < 0) { verdictClass = "btrk-verdict-loss";   arrow = "\u25BC"; }

    const myStats    = sideStats(myCalc.items);
    const theirStats = sideStats(theirCalc.items);

    const panel = document.createElement("div");
    panel.className = "btrk-trade-summary-panel";
    panel.innerHTML = `
      <div class="btrk-summary-header">
        <img src="${chrome.runtime.getURL('icons/icon32.png')}" class="btrk-summary-logo">
        <span>BtrKorone Trade Analysis</span>
      </div>
      <div class="btrk-summary-verdict ${verdictClass}">
        <span class="btrk-verdict-arrow">${arrow}</span>
        <span class="btrk-verdict-amount">${diff >= 0 ? "+" : ""}${formatValue(diff)}</span>
        <span class="btrk-verdict-pct">(${diff >= 0 ? "+" : ""}${pct}%)</span>
      </div>
      <div class="btrk-summary-sides">
        ${renderSideColumn("You Give",    myStats)}
        <div class="btrk-summary-divider" aria-hidden="true"></div>
        ${renderSideColumn("You Receive", theirStats)}
      </div>
    `;

    insertPanelIntoModal(modal, panel);
  }

  /**
   * Compute the per-side breakdown rendered inside the trade analysis panel.
   * RAP is summed across every item (Pekora always returns a market price).
   * Value is summed only across items that have a known Koromons value -
   * if none do, the row collapses to "—" so we don't lie about a 0 total.
   */
  function sideStats(items) {
    const totalRap = items.reduce((s, i) => s + (i.rap || 0), 0);
    const totalValue = items.reduce(
      (s, i) => s + (i.hasKoromonValue ? i.koromonValue : 0), 0);
    const valuedCount = items.filter(i => i.hasKoromonValue).length;
    const demandRating = computeDemandRating(items);
    return { totalRap, totalValue, valuedCount, demandRating };
  }

  function renderSideColumn(title, stats) {
    const valueRow = stats.valuedCount > 0
      ? `<div class="btrk-side-row">
           <span class="btrk-side-icon btrk-icon-koromons" aria-hidden="true">K</span>
           <span class="btrk-side-num">${formatValue(stats.totalValue)}</span>
           <span class="btrk-side-tag">Value</span>
         </div>`
      : `<div class="btrk-side-row btrk-side-row-muted">
           <span class="btrk-side-icon btrk-icon-koromons" aria-hidden="true">K</span>
           <span class="btrk-side-num">&mdash;</span>
           <span class="btrk-side-tag">Value</span>
         </div>`;

    const demandRow = stats.demandRating > 0
      ? `<div class="btrk-side-row btrk-side-row-meta">
           <span class="btrk-side-tag">Demand</span>
           <span class="btrk-side-num">${stats.demandRating.toFixed(1)}/5.0</span>
         </div>`
      : "";

    return `
      <div class="btrk-summary-side">
        <div class="btrk-side-title">${escapeHtml(title)}</div>
        <div class="btrk-side-row">
          <span class="btrk-side-icon btrk-icon-robux" aria-hidden="true">R$</span>
          <span class="btrk-side-num">${formatValue(stats.totalRap)}</span>
          <span class="btrk-side-tag">RAP</span>
        </div>
        ${valueRow}
        ${demandRow}
      </div>
    `;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /**
   * Append our verdict panel inside the modal in the safest possible spot:
   * 1. Just before any element holding Accept/Counter/Decline buttons
   * 2. Otherwise at the end of the modal-body
   * 3. Otherwise at the end of the modal itself
   * In every case the panel is APPENDED, never inserted between item cards,
   * so it can't break Pekora's grid/flex layout.
   */
  function insertPanelIntoModal(modal, panel) {
    // Strategy A: find a button row by looking for the Accept button text.
    const buttons = modal.querySelectorAll("button, input[type='button'], input[type='submit'], a.button");
    for (const btn of buttons) {
      const t = (btn.textContent || btn.value || "").trim().toLowerCase();
      if (t === "accept" || t === "counter" || t === "decline") {
        // Walk up to a row container (with another button alongside it)
        let row = btn.parentElement;
        for (let i = 0; i < 4 && row && row.parentElement; i++) {
          if (row.querySelectorAll("button, input[type='button']").length >= 2) {
            row.parentElement.insertBefore(panel, row);
            return;
          }
          row = row.parentElement;
        }
        break; // fall through to next strategy
      }
    }

    // Strategy B: standard modal selectors
    const actionsRow = modal.querySelector(".modal-footer, .btn-group, .text-center");
    if (actionsRow && actionsRow.parentNode) {
      actionsRow.parentNode.insertBefore(panel, actionsRow);
      return;
    }

    // Strategy C: just append to the modal body / modal
    const modalBody = modal.querySelector(".modal-body") || modal;
    modalBody.appendChild(panel);
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function computeDemandRating(items) {
    const valid = items.filter(i => i.hasKoromonValue && DEMAND_RATING[i.demand]);
    if (valid.length === 0) return 0;
    const sum = valid.reduce((s, i) => s + DEMAND_RATING[i.demand], 0);
    return sum / valid.length;
  }

  function formatValue(val) {
    const num = Math.abs(val);
    const sign = val < 0 ? "-" : "";
    if (num >= 1_000_000) return sign + (num / 1_000_000).toFixed(1) + "M";
    if (num >= 10_000)    return sign + (num / 1_000).toFixed(1) + "K";
    return sign + Math.round(num).toLocaleString();
  }
})();
