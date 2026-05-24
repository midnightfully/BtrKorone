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
  const THUMB_SRC_RX = /\/(images\/thumbnails|thumbnails)\//i;

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

  function isTradePage() {
    return TRADE_PAGES.some(p => window.location.pathname.toLowerCase().includes(p.toLowerCase()));
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
    await refreshTradeCache();
    observeForTradeModal();
  }

  async function refreshTradeCache() {
    if (typeof PekoraAPI === "undefined") return;
    try {
      const [inb, outb] = await Promise.all([
        PekoraAPI.getInboundTrades(),
        PekoraAPI.getOutboundTrades()
      ]);
      cachedTrades = [
        ...((inb && inb.data) || []),
        ...((outb && outb.data) || [])
      ];
      console.log(`[BtrKorone/Trades] Cached ${cachedTrades.length} trades`);
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
      injectedTradeKey = null;
      return;
    }

    const modalKey = generateModalKey(modal);
    if (modalKey === injectedTradeKey) return;
    if (modal.querySelector(".btrk-trade-summary-panel, .btrk-section-summary")) {
      injectedTradeKey = modalKey;
      return;
    }
    injectedTradeKey = modalKey;

    const tradeId = await resolveTradeIdFromModal(modal);
    if (!tradeId) {
      console.log("[BtrKorone/Trades] Modal open but couldn't resolve trade ID; skipping.");
      return;
    }

    const detail = await PekoraAPI.getTradeDetail(tradeId);
    if (!detail) return;

    enhanceModal(modal, detail);
  }

  function findVisibleTradeModal() {
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
    const dataEl = modal.querySelector("[data-trade-id], [data-tradeid]");
    if (dataEl) {
      const id = dataEl.dataset.tradeId || dataEl.dataset.tradeid;
      if (id) return id;
    }

    const idMatch = (modal.innerHTML || "").match(/trade[_-]?id["'\s:=/]+(\d{4,})/i);
    if (idMatch) return idMatch[1];

    const partnerName = extractPartnerName(modal);
    if (partnerName) {
      let match = cachedTrades.find(t =>
        t.user && (t.user.name || "").toLowerCase() === partnerName.toLowerCase()
      );
      if (!match) {
        await refreshTradeCache();
        match = cachedTrades.find(t =>
          t.user && (t.user.name || "").toLowerCase() === partnerName.toLowerCase()
        );
      }
      if (match) return String(match.id);
    }

    return null;
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
    // Walk text nodes looking for "Items you will give" / "Items you will receive"
    const walker = document.createTreeWalker(modal, NodeFilter.SHOW_TEXT);
    let give = null, receive = null;
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.textContent || "").toLowerCase().trim();
      if (!t) continue;
      if (!give && /^items you will give\b/.test(t)) give = node.parentElement;
      else if (!receive && /^items you will receive\b/.test(t)) receive = node.parentElement;
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

    let cls = "btrk-net-even", arrow = "↔", sign = "";
    if (diff > 0)      { cls = "btrk-net-profit"; arrow = "↑"; sign = "+"; }
    else if (diff < 0) { cls = "btrk-net-loss";   arrow = "↓"; sign = "";  } // formatValue handles minus

    const indicator = document.createElement("div");
    indicator.className = `btrk-net-change ${cls}`;
    indicator.innerHTML = `
      <span class="btrk-net-arrow">${arrow}</span>
      <span class="btrk-net-value">${sign}${formatValue(diff)}</span>
      <span class="btrk-net-pct">(${sign}${pct.toFixed(0)}%)</span>
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

    let verdictClass = "btrk-verdict-even", arrow = "↔";
    if (diff > 0)      { verdictClass = "btrk-verdict-profit"; arrow = "↑"; }
    else if (diff < 0) { verdictClass = "btrk-verdict-loss";   arrow = "↓"; }

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
