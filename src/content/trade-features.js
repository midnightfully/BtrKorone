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
  let injectedTradeKey = null;
  let pendingResolveKey = null; // dedupe in-flight resolution attempts

  // Trade ID hint captured from the user's most recent click. The "View
  // Details" link / button on a trade row almost always embeds the trade
  // ID in onclick / href / data-* attributes; capturing it on click is far
  // more reliable than trying to scrape the modal afterwards.
  let lastTradeHint = { id: null, ts: 0 };
  const HINT_TTL_MS = 8000;

  function isTradePage() {
    return TRADE_PAGES.some(p => window.location.pathname.toLowerCase().includes(p.toLowerCase()));
  }

  /**
   * Listen for trade-id hints relayed from the page-spy script (MAIN world).
   * The spy intercepts Pekora's own /apisite/trades/v1/trades/{id} fetch and
   * postMessages the {id} here so we can use it as a definitive hint when
   * the modal opens, without scraping the DOM.
   */
  function installFetchSpyListener() {
    window.addEventListener("message", (event) => {
      // Only accept messages from this exact window (the page itself)
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__btrkorone !== true) return;
      if (data.type !== "TRADE_FETCH") return;

      const raw = String(data.tradeId || "");
      if (!/^\d{3,12}$/.test(raw)) return;

      lastTradeHint = { id: raw, ts: Date.now() };
      console.log(`[BtrKorone/Trades] Fetch spy captured trade ID: ${raw}`);
    });
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
    if (!window.__btrkorone.hasFeature("tradeModal")) return;
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
      // Modal closed - reset both keys so the next open is a fresh attempt
      injectedTradeKey = null;
      pendingResolveKey = null;
      return;
    }

    const modalKey = generateModalKey(modal);
    if (modalKey === injectedTradeKey) return;          // already injected
    if (modalKey === pendingResolveKey) return;         // resolution in flight

    if (modal.querySelector(".btrk-trade-summary-panel, .btrk-section-summary")) {
      injectedTradeKey = modalKey;
      return;
    }

    pendingResolveKey = modalKey;
    try {
      const tradeId = await resolveTradeIdFromModal(modal);
      if (!tradeId) {
        // Don't stamp injectedTradeKey here - we want to retry on the next
        // mutation event in case the cache was empty on the first attempt.
        console.log("[BtrKorone/Trades] Modal open but couldn't resolve trade ID yet; will retry.");
        return;
      }
      console.log(`[BtrKorone/Trades] Resolved trade ID: ${tradeId}`);

      const detail = await PekoraAPI.getTradeDetail(tradeId);
      if (!detail) {
        console.warn(`[BtrKorone/Trades] getTradeDetail(${tradeId}) returned null`);
        return;
      }

      enhanceModal(modal, detail);
      injectedTradeKey = modalKey;                       // stamp ONLY on success
    } finally {
      pendingResolveKey = null;
    }
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

    const sections = findSectionHeadings(modal);
    if (!sections.give && !sections.receive) {
      console.warn("[BtrKorone/Trades] Could not locate give/receive headings; falling back to bottom panel.");
      injectFallbackPanel(modal, myCalc, theirCalc);
      return;
    }

    // 1. Per-card badges
    if (sections.give) {
      badgeItemsBetween(modal, sections.give, sections.receive, myCalc.items);
    }
    if (sections.receive) {
      badgeItemsBetween(modal, sections.receive, null, theirCalc.items);
    }

    // 2. Per-section summary rows
    if (sections.give)    injectSectionSummary(sections.give,    myCalc,    "give");
    if (sections.receive) injectSectionSummary(sections.receive, theirCalc, "receive");

    // 3. Net change between sections
    if (sections.give && sections.receive) {
      injectNetChange(sections.receive, myCalc, theirCalc);
    }
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
   * Walk up from <img> to find a sensible card anchor:
   * a parent that visibly wraps the thumbnail (typically <a> or <div>).
   * We stop as soon as we find an element with non-static layout potential
   * (i.e. one we can flip to position:relative without disrupting siblings).
   */
  function findCardAnchor(img) {
    let el = img.parentElement;
    let depth = 0;
    while (el && depth < 4) {
      const rect = el.getBoundingClientRect();
      // Card should be at least as big as the image but not the whole modal
      if (rect.width >= 40 && rect.width <= 200 && rect.height >= 40 && rect.height <= 220) {
        return el;
      }
      el = el.parentElement;
      depth++;
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
    if (card.querySelector(".btrkorone-value-badge")) return;
    if (getComputedStyle(card).position === "static") {
      card.style.position = "relative";
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
    summary.innerHTML = `
      <div class="btrk-section-row">
        <span class="btrk-section-label">Korone Rolimons Value:</span>
        <span class="btrk-section-val">
          <span class="btrk-icon-rolimons" aria-hidden="true">R</span>
          ${valuedCount > 0 ? formatValue(totalKoroneValue) : "&mdash;"}
        </span>
      </div>
      <div class="btrk-section-row">
        <span class="btrk-section-label">Korone Demand Rating:</span>
        <span class="btrk-section-val">
          <span class="btrk-icon-rolimons" aria-hidden="true">R</span>
          ${demandRating > 0 ? `${demandRating.toFixed(1)}/5.0` : "&mdash;"}
        </span>
      </div>
      <div class="btrk-section-row btrk-section-row-muted">
        <span class="btrk-section-label">Total RAP:</span>
        <span class="btrk-section-val">${formatValue(totalRap)}</span>
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

  function injectNetChange(receiveHeading, myCalc, theirCalc) {
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

    // Place the indicator immediately before the "Items you will receive" section
    const receiveContainer = findSectionContainer(receiveHeading);
    if (receiveContainer && receiveContainer.parentNode) {
      receiveContainer.parentNode.insertBefore(indicator, receiveContainer);
    } else if (receiveHeading.parentNode) {
      receiveHeading.parentNode.insertBefore(indicator, receiveHeading);
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
    if (modal.querySelector(".btrk-trade-summary-panel")) return;

    const myValue    = effectiveTotal(myCalc);
    const theirValue = effectiveTotal(theirCalc);
    const diff = theirValue - myValue;
    const pct = myValue > 0 ? ((diff / myValue) * 100).toFixed(1) : 0;

    let verdictClass = "btrk-verdict-even", arrow = "\u25B6";
    if (diff > 0)      { verdictClass = "btrk-verdict-profit"; arrow = "\u25B2"; }
    else if (diff < 0) { verdictClass = "btrk-verdict-loss";   arrow = "\u25BC"; }

    const allItems = [...myCalc.items, ...theirCalc.items];
    const demandRating = computeDemandRating(allItems);

    const panel = document.createElement("div");
    panel.className = "btrk-trade-summary-panel";
    panel.innerHTML = `
      <div class="btrk-summary-header">
        <img src="${chrome.runtime.getURL('icons/icon32.png')}" class="btrk-summary-logo">
        <span>BtrKorone Trade Analysis</span>
      </div>
      <div class="btrk-summary-grid">
        <div class="btrk-summary-row">
          <span class="btrk-summary-label">Your Total Value</span>
          <span class="btrk-summary-val">${formatValue(myValue)}</span>
        </div>
        <div class="btrk-summary-row">
          <span class="btrk-summary-label">Their Total Value</span>
          <span class="btrk-summary-val">${formatValue(theirValue)}</span>
        </div>
        <div class="btrk-summary-row">
          <span class="btrk-summary-label">Korone Demand Rating</span>
          <span class="btrk-summary-val">${demandRating > 0 ? demandRating.toFixed(1) + "/5.0" : "Unknown"}</span>
        </div>
      </div>
      <div class="btrk-summary-verdict ${verdictClass}">
        <span class="btrk-verdict-arrow">${arrow}</span>
        <span class="btrk-verdict-amount">${diff >= 0 ? "+" : ""}${formatValue(diff)}</span>
        <span class="btrk-verdict-pct">(${pct}%)</span>
      </div>
    `;

    const actionsRow = modal.querySelector(".modal-footer, .btn-group, .text-center");
    if (actionsRow && actionsRow.parentNode) {
      actionsRow.parentNode.insertBefore(panel, actionsRow);
    } else {
      const modalBody = modal.querySelector(".modal-body") || modal;
      modalBody.appendChild(panel);
    }
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
