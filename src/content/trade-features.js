/**
 * BtrKorone - Trade Modal Enhancement (Rex tier)
 *
 * RoPro-style enhancement injected directly into Pekora's trade modal.
 * Adds value badges to each item, total value summary, demand rating,
 * and a green/red verdict indicator.
 *
 * Uses Pekora's trade API (with credentials:include) to get real data
 * instead of fragile DOM scraping.
 */

(function BtrTradeModalFeature() {
  "use strict";

  const TRADE_PAGES = ["/My/Trades.aspx", "/My/Trades", "/trades"];
  let cachedMyUserId = null;
  let cachedTrades = [];        // recent trades by ID for quick lookup
  let injectedTradeKey = null;  // key for the currently rendered modal

  function isTradePage() {
    return TRADE_PAGES.some(p => window.location.pathname.toLowerCase().includes(p.toLowerCase()));
  }

  // === Init ===

  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);

    if (!window.__btrkorone.hasFeature("tradeModal")) return;
    if (!isTradePage()) return;

    init();
  }, 100);

  async function init() {
    // Wait for Koromons data
    if (typeof KoromonsAPI !== "undefined") {
      await KoromonsAPI.load();
    }

    // Get our user ID
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

    // Pre-fetch trades for quick lookup when modals open
    await refreshTradeCache();

    // Watch for trade modals opening
    observeForTradeModal();
  }

  async function refreshTradeCache() {
    if (typeof PekoraAPI === "undefined") return;
    try {
      const [inb, outb] = await Promise.all([
        PekoraAPI.getInboundTrades(),
        PekoraAPI.getOutboundTrades()
      ]);
      const all = [
        ...((inb && inb.data) || []),
        ...((outb && outb.data) || [])
      ];
      cachedTrades = all;
      console.log(`[BtrKorone/Trades] Cached ${all.length} trades`);
    } catch (e) {
      console.warn("[BtrKorone/Trades] Could not pre-fetch trades:", e);
    }
  }

  // ============================================================
  // MODAL DETECTION + ENHANCEMENT
  // ============================================================

  function observeForTradeModal() {
    const observer = new MutationObserver(() => {
      tryEnhanceVisibleModal();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    tryEnhanceVisibleModal();
  }

  async function tryEnhanceVisibleModal() {
    // Find the visible Trade Request modal.
    // Pekora uses Bootstrap-style modals. Be permissive in our selector.
    const modal = findVisibleTradeModal();
    if (!modal) {
      injectedTradeKey = null;
      return;
    }

    // Generate a stable key for the open modal so we don't re-inject endlessly
    const modalKey = generateModalKey(modal);
    if (modalKey === injectedTradeKey) return;
    if (modal.querySelector(".btrk-trade-summary-panel")) {
      injectedTradeKey = modalKey;
      return;
    }

    injectedTradeKey = modalKey;

    // Resolve the trade ID, then fetch detail and enhance.
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
    // Try common Bootstrap and React modal patterns
    const candidates = document.querySelectorAll(
      ".modal.show, .modal.in, .modal-content, [role='dialog'], .trade-modal, .modal-dialog"
    );
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = (el.textContent || "").toLowerCase();
      // Identify trade modals by their headings
      if (text.includes("trade request") ||
          text.includes("items you will give") ||
          text.includes("items you will receive") ||
          text.includes("items you gave") ||
          text.includes("items you received")) {
        // Get the highest meaningful container so we have room for our panel
        return el.closest(".modal-content") || el.closest(".modal") || el;
      }
    }
    return null;
  }

  function generateModalKey(modal) {
    // Hash the visible item names so we know when the modal content changes
    const names = [...modal.querySelectorAll("a, .item-name, .text-truncate")]
      .map(el => el.textContent.trim())
      .filter(s => s.length > 2 && s.length < 80)
      .join("|");
    return names.substring(0, 200);
  }

  /**
   * Try to figure out which trade is currently shown in the modal.
   * Strategy:
   *   1. Look for a data-trade-id attribute or the trade ID embedded in the URL/onclick
   *   2. Look for the partner username inside the modal and match against cachedTrades
   *   3. Refresh the cache and retry
   */
  async function resolveTradeIdFromModal(modal) {
    // Method 1: data attributes / hidden inputs
    const dataEl = modal.querySelector("[data-trade-id], [data-tradeid]");
    if (dataEl) {
      const id = dataEl.dataset.tradeId || dataEl.dataset.tradeid;
      if (id) return id;
    }

    // Method 2: anchor or button hrefs
    const idMatch = (modal.innerHTML || "").match(/trade[_-]?id["'\s:=/]+(\d{4,})/i);
    if (idMatch) return idMatch[1];

    // Method 3: match by partner username
    const partnerName = extractPartnerName(modal);
    if (partnerName) {
      let match = cachedTrades.find(t =>
        t.user && (t.user.name || "").toLowerCase() === partnerName.toLowerCase()
      );
      if (!match) {
        // Refresh once in case cache is stale
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
    // The Pekora modal shows "Trade with USERNAME has been opened"
    const text = modal.textContent || "";
    const m = text.match(/Trade with\s+([A-Za-z0-9_]+)/i);
    if (m) return m[1];

    // Alternative: links to /users/{id}/profile
    const profileLink = modal.querySelector("a[href*='/users/']");
    if (profileLink) {
      const name = (profileLink.textContent || "").trim();
      if (name) return name;
    }

    return null;
  }

  // ============================================================
  // ENHANCEMENT INJECTION
  // ============================================================

  function enhanceModal(modal, tradeDetail) {
    const { myOffer, theirOffer, partner } = PekoraAPI.splitTradeOffers(tradeDetail, cachedMyUserId);
    const myCalc = PekoraAPI.calculateOfferValue(myOffer ? myOffer.userAssets : []);
    const theirCalc = PekoraAPI.calculateOfferValue(theirOffer ? theirOffer.userAssets : []);

    // 1. Tag each item card with its individual value
    injectItemBadges(modal, [...myCalc.items, ...theirCalc.items]);

    // 2. Inject the summary panel
    injectSummaryPanel(modal, myCalc, theirCalc, partner);
  }

  function injectItemBadges(modal, allItems) {
    // Pekora item cards are wrapped in an .imageWrapper or contain an item name.
    // We match by item name text inside each card.
    const cards = modal.querySelectorAll(
      "[class*='imageWrapper'], .item-card, .trade-item, .col-0-2-138"
    );
    cards.forEach(card => {
      if (card.querySelector(".btrkorone-value-badge")) return;
      const text = (card.textContent || "").trim();
      // Find which item this card represents by matching the visible name
      const item = allItems.find(i => i.name && text.toLowerCase().includes(i.name.toLowerCase()));
      if (!item) return;

      const badge = document.createElement("div");
      badge.className = "btrkorone-value-badge";
      const demandColor = item.hasKoromonValue && typeof KoromonsAPI !== "undefined"
        ? KoromonsAPI.getDemandColor(item.demand)
        : "#666";

      if (item.hasKoromonValue) {
        badge.innerHTML = `
          <div class="btrk-badge-line btrk-badge-value">
            <span class="btrk-demand-dot" style="background:${demandColor}"></span>
            ${formatValue(item.koromonValue)}
          </div>
          <div class="btrk-badge-line btrk-badge-rap">
            RAP ${formatValue(item.rap)}
          </div>
        `;
        badge.title = `Value: ${item.koromonValue.toLocaleString()} | RAP: ${item.rap.toLocaleString()} | Demand: ${item.demand}`;
      } else {
        badge.innerHTML = `<div class="btrk-badge-line btrk-badge-rap">RAP ${formatValue(item.rap)}</div>`;
      }

      // Position relative to the card
      if (getComputedStyle(card).position === "static") {
        card.style.position = "relative";
      }
      card.appendChild(badge);
    });
  }

  function injectSummaryPanel(modal, myCalc, theirCalc, partner) {
    if (modal.querySelector(".btrk-trade-summary-panel")) return;

    const diff = theirCalc.totalValue - myCalc.totalValue;
    const pct = myCalc.totalValue > 0 ? ((diff / myCalc.totalValue) * 100).toFixed(1) : 0;
    const allItems = [...myCalc.items, ...theirCalc.items];
    const validDemands = allItems
      .filter(i => i.hasKoromonValue && i.demand && i.demand !== "Unknown")
      .map(i => i.demand);
    const demandText = computeDemandText(validDemands);

    let verdictClass = "btrk-verdict-even";
    let verdictArrow = "→";
    let verdictColor = "#ffd700";
    if (diff > 0) { verdictClass = "btrk-verdict-profit"; verdictArrow = "↑"; verdictColor = "#4ade80"; }
    else if (diff < 0) { verdictClass = "btrk-verdict-loss"; verdictArrow = "↓"; verdictColor = "#f87171"; }

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
          <span class="btrk-summary-val">${formatValue(myCalc.totalValue)}</span>
        </div>
        <div class="btrk-summary-row">
          <span class="btrk-summary-label">Their Total Value</span>
          <span class="btrk-summary-val">${formatValue(theirCalc.totalValue)}</span>
        </div>
        <div class="btrk-summary-row">
          <span class="btrk-summary-label">Korone Demand Rating</span>
          <span class="btrk-summary-val">${demandText}</span>
        </div>
      </div>
      <div class="btrk-summary-verdict ${verdictClass}">
        <span class="btrk-verdict-arrow">${verdictArrow}</span>
        <span class="btrk-verdict-amount">${diff >= 0 ? "+" : ""}${formatValue(diff)}</span>
        <span class="btrk-verdict-pct">(${pct}%)</span>
      </div>
    `;

    // Insert at the bottom of the modal body, before action buttons if possible
    const actionsRow = modal.querySelector(".modal-footer, .btn-group, .text-center");
    if (actionsRow && actionsRow.parentNode) {
      actionsRow.parentNode.insertBefore(panel, actionsRow);
    } else {
      const modalBody = modal.querySelector(".modal-body") || modal;
      modalBody.appendChild(panel);
    }
  }

  function computeDemandText(demands) {
    if (!demands || demands.length === 0) return "Unknown";
    // Compute most common demand
    const counts = {};
    demands.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
    let top = "Unknown", topCount = 0;
    for (const [d, c] of Object.entries(counts)) {
      if (c > topCount) { top = d; topCount = c; }
    }
    return top;
  }

  // === Helpers ===

  function formatValue(val) {
    const num = Math.abs(val);
    const sign = val < 0 ? "-" : "";
    if (num >= 1000000) return sign + (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return sign + (num / 1000).toFixed(1) + "K";
    return sign + (num | 0).toLocaleString();
  }
})();
