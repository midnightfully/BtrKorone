/**
 * BtrKorone - Trade Features (API-driven)
 *
 * Uses Pekora's trade API directly for reliable data instead of DOM scraping.
 * Activates only on /My/Trades.aspx and trade-related pages.
 */

(function BtrTradeFeatures() {
  "use strict";

  const TRADE_PAGES = ["/My/Trades.aspx", "/trades", "/My/Trades"];
  let cachedMyUserId = null;

  function isTradePage() {
    return TRADE_PAGES.some(p => window.location.pathname.toLowerCase().includes(p.toLowerCase()));
  }

  // === Init ===

  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);
    if (window.__btrkorone.tier < 1) return; // Plus or higher only
    if (!isTradePage()) return;

    init();
  }, 100);

  async function init() {
    const { hasFeature } = window.__btrkorone;

    // Wait for Koromons + APIs
    if (typeof KoromonsAPI !== "undefined") {
      await KoromonsAPI.load();
    }

    // Get our user ID
    if (typeof PekoraAPI !== "undefined") {
      const me = await PekoraAPI.getAuthenticatedUser();
      if (me) cachedMyUserId = me.id;
    }

    if (!cachedMyUserId) {
      // Fallback: read from extension storage
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

    // === Plus Tier Features ===
    if (hasFeature("tradeOverlay")) {
      injectTradeOverlay();
    }

    if (hasFeature("tradeEnhancements")) {
      observeForTradeModal();
      enhanceTradeRows();
    }

    // === Rex Tier Features ===
    if (hasFeature("advancedTradeCalculator")) {
      injectTradeCalculator();
    }
  }

  // ============================================================
  // TRADE OVERLAY (floating panel, draggable, minimizable)
  // ============================================================

  function injectTradeOverlay() {
    if (document.querySelector(".btrkorone-trade-overlay")) return;

    const overlay = document.createElement("div");
    overlay.className = "btrkorone-trade-overlay";
    overlay.innerHTML = `
      <div class="btrk-overlay-header">
        <span class="btrk-overlay-title">Trade Overview</span>
        <button class="btrk-overlay-toggle" id="btrk-overlay-toggle" title="Minimize">&#8722;</button>
      </div>
      <div class="btrk-overlay-body" id="btrk-overlay-body">
        <div class="btrk-overlay-section">
          <h4>Offering</h4>
          <div class="btrk-overlay-items" id="btrk-overlay-offering">
            <span class="btrk-overlay-empty">Open a trade to see analysis</span>
          </div>
          <div class="btrk-overlay-total">Total: <span id="btrk-overlay-offer-total">0</span></div>
        </div>
        <div class="btrk-overlay-divider"></div>
        <div class="btrk-overlay-section">
          <h4>Requesting</h4>
          <div class="btrk-overlay-items" id="btrk-overlay-requesting">
            <span class="btrk-overlay-empty">Open a trade to see analysis</span>
          </div>
          <div class="btrk-overlay-total">Total: <span id="btrk-overlay-req-total">0</span></div>
        </div>
        <div class="btrk-overlay-verdict" id="btrk-overlay-verdict">
          Select a trade to analyze
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Minimize toggle
    const toggleBtn = overlay.querySelector("#btrk-overlay-toggle");
    const body = overlay.querySelector("#btrk-overlay-body");
    toggleBtn.addEventListener("click", () => {
      const minimized = body.style.display === "none";
      body.style.display = minimized ? "block" : "none";
      toggleBtn.innerHTML = minimized ? "&#8722;" : "&#43;";
    });

    // Make draggable
    makeDraggable(overlay, overlay.querySelector(".btrk-overlay-header"));
  }

  function updateOverlayWithTrade(tradeDetail) {
    if (!tradeDetail) return;
    const overlay = document.querySelector(".btrkorone-trade-overlay");
    if (!overlay) return;

    const { myOffer, theirOffer, partner } = PekoraAPI.splitTradeOffers(tradeDetail, cachedMyUserId);
    const myCalc = PekoraAPI.calculateOfferValue(myOffer ? myOffer.userAssets : []);
    const theirCalc = PekoraAPI.calculateOfferValue(theirOffer ? theirOffer.userAssets : []);

    // Update title with partner
    if (partner) {
      overlay.querySelector(".btrk-overlay-title").textContent = `Trade with ${partner.name}`;
    }

    // Update offering side
    const offerEl = overlay.querySelector("#btrk-overlay-offering");
    offerEl.innerHTML = renderItemList(myCalc.items);

    const reqEl = overlay.querySelector("#btrk-overlay-requesting");
    reqEl.innerHTML = renderItemList(theirCalc.items);

    overlay.querySelector("#btrk-overlay-offer-total").textContent = formatValue(myCalc.totalValue);
    overlay.querySelector("#btrk-overlay-req-total").textContent = formatValue(theirCalc.totalValue);

    // Verdict
    const verdictEl = overlay.querySelector("#btrk-overlay-verdict");
    const diff = theirCalc.totalValue - myCalc.totalValue;
    if (myCalc.totalValue === 0 && theirCalc.totalValue === 0) {
      verdictEl.textContent = "No valued items in this trade";
      verdictEl.className = "btrk-overlay-verdict";
    } else {
      const pct = myCalc.totalValue > 0 ? ((diff / myCalc.totalValue) * 100).toFixed(1) : 0;
      if (diff > 0) {
        verdictEl.textContent = `WIN: +${formatValue(diff)} (+${pct}%)`;
        verdictEl.className = "btrk-overlay-verdict btrk-verdict-profit";
      } else if (diff < 0) {
        verdictEl.textContent = `LOSS: ${formatValue(diff)} (${pct}%)`;
        verdictEl.className = "btrk-overlay-verdict btrk-verdict-loss";
      } else {
        verdictEl.textContent = "EVEN TRADE";
        verdictEl.className = "btrk-overlay-verdict btrk-verdict-even";
      }
    }
  }

  function renderItemList(items) {
    if (!items || items.length === 0) {
      return '<span class="btrk-overlay-empty">No items</span>';
    }
    return items.map(item => {
      const valueText = item.hasKoromonValue
        ? `<span class="btrk-overlay-item-value">${formatValue(item.koromonValue)}</span>`
        : `<span class="btrk-overlay-item-rap">RAP ${formatValue(item.rap)}</span>`;
      const demandColor = item.hasKoromonValue && typeof KoromonsAPI !== "undefined"
        ? KoromonsAPI.getDemandColor(item.demand)
        : "#555";
      return `<div class="btrk-overlay-item-line">
        <span class="btrk-demand-dot" style="background:${demandColor}"></span>
        <span class="btrk-overlay-item-name">${escapeHtml(item.name)}</span>
        ${valueText}
      </div>`;
    }).join("");
  }

  // ============================================================
  // TRADE TABLE ROW ENHANCEMENTS
  // Adds value column to the trade list (My Transactions tab)
  // ============================================================

  let tradeRowCache = new Map();

  async function enhanceTradeRows() {
    // Pre-fetch all trade types so we can map trade IDs -> values
    const inbound = await PekoraAPI.getInboundTrades();
    const outbound = await PekoraAPI.getOutboundTrades();
    const allTrades = [
      ...((inbound && inbound.data) || []),
      ...((outbound && outbound.data) || [])
    ];

    console.log(`[BtrKorone/Trades] Loaded ${allTrades.length} trades for row enhancement`);

    // Continuously try to find trade rows in the table
    const observer = new MutationObserver(() => annotateTradeRows(allTrades));
    observer.observe(document.body, { childList: true, subtree: true });
    annotateTradeRows(allTrades);
  }

  async function annotateTradeRows(trades) {
    // Pekora's trade table uses tr elements with date cells.
    // We try to find rows that link to a specific trade modal.
    const rows = document.querySelectorAll("tr:not(.btrk-row-enhanced), .trade-row:not(.btrk-row-enhanced)");

    rows.forEach(async row => {
      // Try to extract a trade ID from any link/button within the row
      const link = row.querySelector("a[href*='trade'], a[onclick*='trade'], [data-trade-id]");
      let tradeId = null;

      if (link) {
        if (link.dataset.tradeId) tradeId = link.dataset.tradeId;
        else {
          const href = link.getAttribute("href") || link.getAttribute("onclick") || "";
          const match = href.match(/(\d{4,})/);
          if (match) tradeId = match[1];
        }
      }

      if (!tradeId) return;
      row.classList.add("btrk-row-enhanced");

      // Don't fetch if we already cached
      let detail = tradeRowCache.get(tradeId);
      if (!detail) {
        detail = await PekoraAPI.getTradeDetail(tradeId);
        if (detail) tradeRowCache.set(tradeId, detail);
      }
      if (!detail) return;

      const { myOffer, theirOffer } = PekoraAPI.splitTradeOffers(detail, cachedMyUserId);
      const myCalc = PekoraAPI.calculateOfferValue(myOffer ? myOffer.userAssets : []);
      const theirCalc = PekoraAPI.calculateOfferValue(theirOffer ? theirOffer.userAssets : []);
      const diff = theirCalc.totalValue - myCalc.totalValue;
      const pct = myCalc.totalValue > 0 ? ((diff / myCalc.totalValue) * 100).toFixed(0) : 0;

      // Inject value cell
      const valueCell = document.createElement("td");
      valueCell.className = "btrk-trade-value-cell";
      const verdict = diff > 0 ? "btrk-verdict-profit" : diff < 0 ? "btrk-verdict-loss" : "btrk-verdict-even";
      const sign = diff >= 0 ? "+" : "";
      valueCell.innerHTML = `
        <div class="btrk-trade-value-summary ${verdict}">
          <span class="btrk-trade-vs">${formatValue(myCalc.totalValue)} → ${formatValue(theirCalc.totalValue)}</span>
          <span class="btrk-trade-diff">${sign}${pct}%</span>
        </div>
      `;
      row.appendChild(valueCell);
    });
  }

  // ============================================================
  // TRADE MODAL DETECTION
  // Watches for the trade detail modal opening and updates overlay
  // ============================================================

  function observeForTradeModal() {
    // Pekora modals usually have a class like "modal" and become visible
    let activeTradeId = null;

    const checkForModal = async () => {
      const modal = document.querySelector(".modal:not(.btrk-modal-watched)");
      if (!modal) return;

      // Try to extract trade ID from modal content or URL
      const tradeId = extractActiveTradeId();
      if (tradeId && tradeId !== activeTradeId) {
        activeTradeId = tradeId;
        modal.classList.add("btrk-modal-watched");
        const detail = await PekoraAPI.getTradeDetail(tradeId);
        if (detail) {
          updateOverlayWithTrade(detail);
          injectModalValueTags(modal, detail);
        }
      }
    };

    const observer = new MutationObserver(checkForModal);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    checkForModal();
  }

  function extractActiveTradeId() {
    // Method 1: data attributes
    const el = document.querySelector("[data-active-trade-id], [data-trade-id]");
    if (el) {
      return el.dataset.activeTradeId || el.dataset.tradeId;
    }

    // Method 2: URL hash
    const hash = window.location.hash;
    const hashMatch = hash.match(/trade[=/](\d+)/i);
    if (hashMatch) return hashMatch[1];

    // Method 3: URL query string
    const urlMatch = window.location.search.match(/[?&]tradeId=(\d+)/i);
    if (urlMatch) return urlMatch[1];

    return null;
  }

  function injectModalValueTags(modal, tradeDetail) {
    const { myOffer, theirOffer } = PekoraAPI.splitTradeOffers(tradeDetail, cachedMyUserId);
    const myCalc = PekoraAPI.calculateOfferValue(myOffer ? myOffer.userAssets : []);
    const theirCalc = PekoraAPI.calculateOfferValue(theirOffer ? theirOffer.userAssets : []);

    // Find item cards in modal and tag them by name match
    const itemCards = modal.querySelectorAll(".item-card, .trade-item, [class*='item']");
    const allItems = [...myCalc.items, ...theirCalc.items];

    itemCards.forEach(card => {
      if (card.querySelector(".btrkorone-value-tag")) return;
      const text = card.textContent || "";
      const matched = allItems.find(i => i.name && text.includes(i.name));
      if (!matched) return;

      const tag = document.createElement("div");
      tag.className = "btrkorone-value-tag";
      if (matched.hasKoromonValue) {
        tag.classList.add("btrk-valued-live");
        tag.innerHTML = `<span class="btrk-demand-dot" style="background:${KoromonsAPI.getDemandColor(matched.demand)}"></span>${formatValue(matched.koromonValue)}`;
        tag.title = `Value: ${matched.koromonValue.toLocaleString()} | RAP: ${matched.rap.toLocaleString()} | Demand: ${matched.demand}`;
      } else {
        tag.classList.add("btrk-no-value");
        tag.textContent = `RAP ${formatValue(matched.rap)}`;
      }
      card.style.position = "relative";
      card.appendChild(tag);
    });
  }

  // ============================================================
  // ADVANCED TRADE CALCULATOR (Rex tier)
  // ============================================================

  function injectTradeCalculator() {
    if (document.querySelector(".btrkorone-calc")) return;

    const tradeArea = document.querySelector(
      ".trade-container, #trade-window, .trade-content, .trades-page, body"
    );
    if (!tradeArea) return;

    const calc = document.createElement("div");
    calc.className = "btrkorone-calc btrkorone-calc-floating";
    calc.innerHTML = `
      <div class="btrk-calc-header">
        <span>Trade Calculator</span>
        <span class="btrk-calc-badge">REX</span>
      </div>
      <div class="btrk-calc-body">
        <div class="btrk-calc-row">
          <label>Your value:</label>
          <input type="number" class="btrk-calc-input" id="btrk-calc-yours" placeholder="0">
        </div>
        <div class="btrk-calc-row">
          <label>Their value:</label>
          <input type="number" class="btrk-calc-input" id="btrk-calc-theirs" placeholder="0">
        </div>
        <div class="btrk-calc-result" id="btrk-calc-result">
          Enter values for analysis
        </div>
      </div>
    `;
    document.body.appendChild(calc);

    const yoursInput = calc.querySelector("#btrk-calc-yours");
    const theirsInput = calc.querySelector("#btrk-calc-theirs");
    const resultEl = calc.querySelector("#btrk-calc-result");

    const calculate = () => {
      const yours = parseInt(yoursInput.value) || 0;
      const theirs = parseInt(theirsInput.value) || 0;
      const diff = theirs - yours;
      const pct = yours > 0 ? ((diff / yours) * 100).toFixed(1) : 0;
      if (yours === 0 && theirs === 0) {
        resultEl.textContent = "Enter values for analysis";
        resultEl.className = "btrk-calc-result";
      } else if (diff > 0) {
        resultEl.textContent = `Profit: +${diff.toLocaleString()} (+${pct}%)`;
        resultEl.className = "btrk-calc-result btrk-calc-profit";
      } else if (diff < 0) {
        resultEl.textContent = `Loss: ${diff.toLocaleString()} (${pct}%)`;
        resultEl.className = "btrk-calc-result btrk-calc-loss";
      } else {
        resultEl.textContent = "Even trade";
        resultEl.className = "btrk-calc-result btrk-calc-even";
      }
    };

    yoursInput.addEventListener("input", calculate);
    theirsInput.addEventListener("input", calculate);
  }

  // ============================================================
  // UTILITIES
  // ============================================================

  function makeDraggable(element, handle) {
    let startX = 0, startY = 0;
    handle.style.cursor = "grab";
    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      handle.style.cursor = "grabbing";
      const onMove = ev => {
        const dx = startX - ev.clientX;
        const dy = startY - ev.clientY;
        startX = ev.clientX;
        startY = ev.clientY;
        element.style.top = (element.offsetTop - dy) + "px";
        element.style.left = (element.offsetLeft - dx) + "px";
        element.style.right = "auto";
        element.style.bottom = "auto";
      };
      const onUp = () => {
        handle.style.cursor = "grab";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function formatValue(val) {
    const num = Math.abs(val);
    const sign = val < 0 ? "-" : "";
    if (num >= 1000000) return sign + (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return sign + (num / 1000).toFixed(1) + "K";
    return sign + (num | 0).toLocaleString();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
})();
