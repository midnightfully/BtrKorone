/**
 * BtrKorone - Premium Features
 * Features exclusive to BtrKorone+ and BtrKorone Rex tiers
 * Includes: Trade overlay (fixed), trade enhancements, catalog filters,
 * item value estimates, advanced trade calculator, server indicator,
 * friend activity feed, notifications popup
 */

(function BtrPremiumFeatures() {
  "use strict";

  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);

    const { tier } = window.__btrkorone;
    if (tier === 0) return; // No premium features for free tier

    init();
  }, 50);

  async function init() {
    const { hasFeature } = window.__btrkorone;

    // Load Koromons live data (public API, no auth needed)
    if (typeof KoromonsAPI !== "undefined") {
      const loaded = await KoromonsAPI.load();
      if (loaded) {
        console.log(`[BtrKorone] Koromons data loaded: ${KoromonsAPI.itemCount} items`);
        window.__btrkorone.koromons = KoromonsAPI;
      } else {
        console.warn("[BtrKorone] Koromons data unavailable - value features degraded");
      }
    }

    // === PLUS TIER ===
    if (hasFeature("tradeEnhancements")) initTradeEnhancements();
    if (hasFeature("tradeOverlay")) initTradeOverlay();
    if (hasFeature("catalogFilters")) initCatalogFilters();

    // === REX TIER ===
    if (hasFeature("itemValueEstimates")) initItemValueEstimates();
    if (hasFeature("advancedTradeCalculator")) initAdvancedTradeCalculator();
    if (hasFeature("serverSizeIndicator")) initServerSizeIndicator();
    if (hasFeature("friendActivityFeed")) initFriendActivityFeed();
    if (hasFeature("notificationsPopup")) initNotificationsPopup();
  }

  // ============================================================
  // PLUS TIER: Trade Enhancements
  // ============================================================

  function initTradeEnhancements() {
    if (!window.location.pathname.includes("/trade")) return;

    const observer = new MutationObserver(() => enhanceTradeItems());

    const tradeContainer = document.querySelector(
      ".trade-container, #trade-window, .trade-content, .trades-page"
    );
    if (tradeContainer) {
      observer.observe(tradeContainer, { childList: true, subtree: true });
      enhanceTradeItems();
    } else {
      // Fallback: observe body until trade container appears
      const bodyObs = new MutationObserver(() => {
        const tc = document.querySelector(".trade-container, #trade-window, .trade-content, .trades-page");
        if (tc) {
          bodyObs.disconnect();
          observer.observe(tc, { childList: true, subtree: true });
          enhanceTradeItems();
        }
      });
      bodyObs.observe(document.body, { childList: true, subtree: true });
    }
  }

  function enhanceTradeItems() {
    const items = document.querySelectorAll(".trade-item:not(.btrk-trade-enhanced)");
    items.forEach((item) => {
      item.classList.add("btrk-trade-enhanced", "btrkorone-trade-item");

      // Extract item name from the element
      const nameEl = item.querySelector(".item-name, .asset-name, .name, [data-item-name]");
      const itemName = nameEl?.textContent?.trim() || nameEl?.dataset?.itemName || item.dataset?.itemName || "";

      // Look up live value from Koromons
      const valueTag = document.createElement("div");
      valueTag.className = "btrkorone-value-tag";

      if (itemName && KoromonsAPI && KoromonsAPI.isLoaded) {
        const data = KoromonsAPI.getItemData(itemName);
        if (data && data.value > 0) {
          valueTag.textContent = formatValue(data.value);
          valueTag.title = `Value: ${data.value.toLocaleString()} | RAP: ${data.rap.toLocaleString()} | Demand: ${data.demand}`;
          valueTag.classList.add("btrk-valued-live");

          // Add demand dot
          const demandDot = document.createElement("span");
          demandDot.className = "btrk-demand-dot";
          demandDot.style.background = KoromonsAPI.getDemandColor(data.demand);
          demandDot.title = `Demand: ${data.demand}`;
          valueTag.prepend(demandDot);
        } else {
          valueTag.textContent = "N/V";
          valueTag.classList.add("btrk-no-value");
        }
      } else {
        valueTag.textContent = "---";
      }

      item.appendChild(valueTag);
    });

    updateTradeSummary();
  }

  function updateTradeSummary() {
    let summary = document.querySelector(".btrkorone-trade-summary");
    const tradeWindow = document.querySelector(
      ".trade-container, #trade-window, .trade-content, .trades-page"
    );
    if (!tradeWindow) return;

    if (!summary) {
      summary = document.createElement("div");
      summary.className = "btrkorone-trade-summary";
      summary.innerHTML = `
        <div class="trade-summary-row">
          <span>Your Value:</span>
          <span class="trade-value-your">---</span>
        </div>
        <div class="trade-summary-row">
          <span>Their Value:</span>
          <span class="trade-value-their">---</span>
        </div>
        <div class="trade-summary-row trade-summary-diff">
          <span>Difference:</span>
          <span class="trade-value-diff">---</span>
        </div>
      `;
      tradeWindow.appendChild(summary);
    }

    // Calculate live totals from value tags
    if (!KoromonsAPI || !KoromonsAPI.isLoaded) return;

    const offerSection = document.querySelector(".trade-offer, .your-items, [data-trade-side='offer']");
    const reqSection = document.querySelector(".trade-request, .their-items, [data-trade-side='request']");

    const sumValues = (section) => {
      if (!section) return 0;
      let total = 0;
      section.querySelectorAll(".trade-item, .item").forEach(item => {
        const nameEl = item.querySelector(".item-name, .asset-name, .name, [data-item-name]");
        const name = nameEl?.textContent?.trim() || nameEl?.dataset?.itemName || item.dataset?.itemName || "";
        if (name) {
          const val = KoromonsAPI.getValue(name) || KoromonsAPI.getValue(KoromonsAPI.fuzzySearch(name));
          total += val;
        }
      });
      return total;
    };

    const myTotal = sumValues(offerSection);
    const theirTotal = sumValues(reqSection);
    const diff = theirTotal - myTotal;

    const yourEl = summary.querySelector(".trade-value-your");
    const theirEl = summary.querySelector(".trade-value-their");
    const diffEl = summary.querySelector(".trade-value-diff");

    if (yourEl) yourEl.textContent = myTotal > 0 ? formatValue(myTotal) : "---";
    if (theirEl) theirEl.textContent = theirTotal > 0 ? formatValue(theirTotal) : "---";
    if (diffEl) {
      if (myTotal > 0 || theirTotal > 0) {
        const sign = diff >= 0 ? "+" : "";
        diffEl.textContent = `${sign}${formatValue(diff)}`;
        diffEl.style.color = diff > 0 ? "#4caf50" : diff < 0 ? "#f44336" : "#ffd700";
      } else {
        diffEl.textContent = "---";
        diffEl.style.color = "";
      }
    }
  }

  // ============================================================
  // PLUS TIER: Trade Overlay (FIXED)
  // ============================================================

  function initTradeOverlay() {
    if (!window.location.pathname.includes("/trade")) return;

    // Remove any broken existing overlays first
    const existingOverlay = document.querySelector(".btrkorone-trade-overlay");
    if (existingOverlay) existingOverlay.remove();

    // Create overlay container
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
            <span class="btrk-overlay-empty">No items</span>
          </div>
          <div class="btrk-overlay-total">Total: <span id="btrk-overlay-offer-total">0</span></div>
        </div>
        <div class="btrk-overlay-divider"></div>
        <div class="btrk-overlay-section">
          <h4>Requesting</h4>
          <div class="btrk-overlay-items" id="btrk-overlay-requesting">
            <span class="btrk-overlay-empty">No items</span>
          </div>
          <div class="btrk-overlay-total">Total: <span id="btrk-overlay-req-total">0</span></div>
        </div>
        <div class="btrk-overlay-verdict" id="btrk-overlay-verdict">
          Select items to see trade analysis
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Toggle minimize
    const toggleBtn = document.getElementById("btrk-overlay-toggle");
    const body = document.getElementById("btrk-overlay-body");
    toggleBtn.addEventListener("click", () => {
      const isMinimized = body.style.display === "none";
      body.style.display = isMinimized ? "block" : "none";
      toggleBtn.innerHTML = isMinimized ? "&#8722;" : "&#43;";
    });

    // Make overlay draggable
    makeDraggable(overlay, overlay.querySelector(".btrk-overlay-header"));

    // Observe trade changes to update overlay
    const tradeObserver = new MutationObserver(() => updateOverlayData());
    const tradeArea = document.querySelector(
      ".trade-container, #trade-window, .trade-content, .trades-page"
    );
    if (tradeArea) {
      tradeObserver.observe(tradeArea, { childList: true, subtree: true });
    } else {
      const waitForTrade = new MutationObserver(() => {
        const ta = document.querySelector(".trade-container, #trade-window, .trade-content, .trades-page");
        if (ta) {
          waitForTrade.disconnect();
          tradeObserver.observe(ta, { childList: true, subtree: true });
        }
      });
      waitForTrade.observe(document.body, { childList: true, subtree: true });
    }
  }

  function updateOverlayData() {
    // Count items in offering/requesting sections
    const offerSection = document.querySelector(".trade-offer, .your-items, [data-trade-side='offer']");
    const reqSection = document.querySelector(".trade-request, .their-items, [data-trade-side='request']");

    const offerItems = offerSection ? offerSection.querySelectorAll(".trade-item, .item") : [];
    const reqItems = reqSection ? reqSection.querySelectorAll(".trade-item, .item") : [];

    const offerEl = document.getElementById("btrk-overlay-offering");
    const reqEl = document.getElementById("btrk-overlay-requesting");
    const offerTotalEl = document.getElementById("btrk-overlay-offer-total");
    const reqTotalEl = document.getElementById("btrk-overlay-req-total");
    const verdictEl = document.getElementById("btrk-overlay-verdict");

    // Calculate values using Koromons
    const calcSectionValue = (items) => {
      let total = 0;
      let names = [];
      items.forEach(item => {
        const nameEl = item.querySelector(".item-name, .asset-name, .name, [data-item-name]");
        const name = nameEl?.textContent?.trim() || nameEl?.dataset?.itemName || item.dataset?.itemName || "";
        if (name && KoromonsAPI && KoromonsAPI.isLoaded) {
          const val = KoromonsAPI.getValue(name);
          total += val;
          if (val > 0) names.push(`${name} (${formatValue(val)})`);
          else names.push(`${name} (N/V)`);
        } else if (name) {
          names.push(name);
        }
      });
      return { total, names };
    };

    const offer = calcSectionValue(offerItems);
    const req = calcSectionValue(reqItems);

    if (offerEl) {
      offerEl.innerHTML = offer.names.length > 0
        ? offer.names.map(n => `<div class="btrk-overlay-item-line">${n}</div>`).join("")
        : '<span class="btrk-overlay-empty">No items</span>';
    }

    if (reqEl) {
      reqEl.innerHTML = req.names.length > 0
        ? req.names.map(n => `<div class="btrk-overlay-item-line">${n}</div>`).join("")
        : '<span class="btrk-overlay-empty">No items</span>';
    }

    if (offerTotalEl) offerTotalEl.textContent = offer.total > 0 ? formatValue(offer.total) : "0";
    if (reqTotalEl) reqTotalEl.textContent = req.total > 0 ? formatValue(req.total) : "0";

    // Verdict
    if (verdictEl) {
      if (offer.total === 0 && req.total === 0) {
        verdictEl.textContent = "Select items to see trade analysis";
        verdictEl.className = "btrk-overlay-verdict";
      } else {
        const diff = req.total - offer.total;
        const pct = offer.total > 0 ? ((diff / offer.total) * 100).toFixed(1) : 0;
        if (diff > 0) {
          verdictEl.textContent = `PROFIT: +${formatValue(diff)} (+${pct}%)`;
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
  }

  function makeDraggable(element, handle) {
    let offsetX = 0, offsetY = 0, startX = 0, startY = 0;

    handle.style.cursor = "grab";
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      handle.style.cursor = "grabbing";

      const onMove = (ev) => {
        offsetX = startX - ev.clientX;
        offsetY = startY - ev.clientY;
        startX = ev.clientX;
        startY = ev.clientY;
        element.style.top = (element.offsetTop - offsetY) + "px";
        element.style.left = (element.offsetLeft - offsetX) + "px";
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

  // ============================================================
  // PLUS TIER: Catalog Filters
  // ============================================================

  function initCatalogFilters() {
    if (!window.location.pathname.includes("/catalog")) return;

    const container = document.querySelector(
      ".catalog-container, #catalog, .catalog-content, .catalog-page"
    );
    if (!container || container.querySelector(".btrkorone-catalog-filters")) return;

    const filterBar = document.createElement("div");
    filterBar.className = "btrkorone-catalog-filters";
    filterBar.innerHTML = `
      <div class="btrk-filter-group">
        <label>Price:</label>
        <input type="number" class="btrk-filter-input" id="btrk-price-min" placeholder="Min">
        <span class="btrk-filter-sep">-</span>
        <input type="number" class="btrk-filter-input" id="btrk-price-max" placeholder="Max">
      </div>
      <div class="btrk-filter-group">
        <label>Sort:</label>
        <select class="btrk-filter-select" id="btrk-sort">
          <option value="default">Default</option>
          <option value="price-asc">Price: Low-High</option>
          <option value="price-desc">Price: High-Low</option>
          <option value="newest">Newest</option>
        </select>
      </div>
      <button class="btrk-filter-btn" id="btrk-apply-filters">Apply</button>
      <button class="btrk-filter-btn btrk-filter-reset" id="btrk-reset-filters">Reset</button>
    `;

    container.prepend(filterBar);

    document.getElementById("btrk-apply-filters")?.addEventListener("click", applyCatalogFilters);
    document.getElementById("btrk-reset-filters")?.addEventListener("click", resetCatalogFilters);
  }

  function applyCatalogFilters() {
    const min = parseInt(document.getElementById("btrk-price-min")?.value) || 0;
    const max = parseInt(document.getElementById("btrk-price-max")?.value) || Infinity;

    document.querySelectorAll(".catalog-item, .item-card, .asset-card").forEach((item) => {
      const priceEl = item.querySelector(".item-price, .price, .robux-price");
      if (!priceEl) return;
      const price = parseInt(priceEl.textContent.replace(/[^0-9]/g, "")) || 0;
      item.style.display = (price >= min && price <= max) ? "" : "none";
    });
  }

  function resetCatalogFilters() {
    const minEl = document.getElementById("btrk-price-min");
    const maxEl = document.getElementById("btrk-price-max");
    const sortEl = document.getElementById("btrk-sort");
    if (minEl) minEl.value = "";
    if (maxEl) maxEl.value = "";
    if (sortEl) sortEl.value = "default";

    document.querySelectorAll(".catalog-item, .item-card, .asset-card").forEach((item) => {
      item.style.display = "";
    });
  }

  // ============================================================
  // REX TIER: Item Value Estimates
  // ============================================================

  function initItemValueEstimates() {
    addValueEstimates();

    const observer = new MutationObserver(() => addValueEstimates());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function addValueEstimates() {
    const items = document.querySelectorAll(
      ".item-card:not(.btrk-valued), .catalog-item:not(.btrk-valued), .inventory-item:not(.btrk-valued), .asset-card:not(.btrk-valued)"
    );

    items.forEach((item) => {
      item.classList.add("btrk-valued");

      // Extract item name
      const nameEl = item.querySelector(".item-name, .asset-name, .name, [data-item-name], .card-title");
      const itemName = nameEl?.textContent?.trim() || nameEl?.dataset?.itemName || item.dataset?.itemName || "";

      const est = document.createElement("div");
      est.className = "btrkorone-value-estimate";

      if (itemName && KoromonsAPI && KoromonsAPI.isLoaded) {
        const data = KoromonsAPI.getItemData(itemName);
        if (data && data.value > 0) {
          est.innerHTML = `
            <span class="btrk-est-label">Val:</span>
            <span class="btrk-est-value">${formatValue(data.value)}</span>
            <span class="btrk-demand-badge" style="background:${KoromonsAPI.getDemandColor(data.demand)}">${data.demand}</span>
          `;
          est.title = `Value: ${data.value.toLocaleString()} | RAP: ${data.rap.toLocaleString()} | Demand: ${data.demand} | Trend: ${data.trend}\nSupply: ${data.supply.available} available, ${data.supply.hoarded} hoarded`;
        } else {
          est.innerHTML = '<span class="btrk-est-label">Val:</span> <span class="btrk-est-value btrk-no-val">N/A</span>';
        }
      } else {
        est.innerHTML = '<span class="btrk-est-label">Val:</span> <span class="btrk-est-value">---</span>';
      }

      item.appendChild(est);
    });
  }

  // ============================================================
  // REX TIER: Advanced Trade Calculator
  // ============================================================

  function initAdvancedTradeCalculator() {
    if (!window.location.pathname.includes("/trade")) return;

    const tradeArea = document.querySelector(
      ".trade-container, #trade-window, .trade-content, .trades-page"
    );
    if (!tradeArea || tradeArea.querySelector(".btrkorone-calc")) return;

    const calc = document.createElement("div");
    calc.className = "btrkorone-calc";
    calc.innerHTML = `
      <div class="btrk-calc-header">
        <span>Trade Calculator</span>
        <span class="btrk-calc-badge">REX</span>
      </div>
      <div class="btrk-calc-body">
        <div class="btrk-calc-row">
          <label>Your total value:</label>
          <input type="number" class="btrk-calc-input" id="btrk-calc-yours" placeholder="0">
        </div>
        <div class="btrk-calc-row">
          <label>Their total value:</label>
          <input type="number" class="btrk-calc-input" id="btrk-calc-theirs" placeholder="0">
        </div>
        <div class="btrk-calc-result" id="btrk-calc-result">
          Enter values to see profit/loss
        </div>
      </div>
    `;

    tradeArea.appendChild(calc);

    const yoursInput = document.getElementById("btrk-calc-yours");
    const theirsInput = document.getElementById("btrk-calc-theirs");
    const resultEl = document.getElementById("btrk-calc-result");

    function calculate() {
      const yours = parseInt(yoursInput.value) || 0;
      const theirs = parseInt(theirsInput.value) || 0;
      const diff = theirs - yours;
      const pct = yours > 0 ? ((diff / yours) * 100).toFixed(1) : 0;

      if (yours === 0 && theirs === 0) {
        resultEl.textContent = "Enter values to see profit/loss";
        resultEl.className = "btrk-calc-result";
      } else if (diff > 0) {
        resultEl.textContent = `Profit: +${diff.toLocaleString()} (+${pct}%)`;
        resultEl.className = "btrk-calc-result btrk-calc-profit";
      } else if (diff < 0) {
        resultEl.textContent = `Loss: ${diff.toLocaleString()} (${pct}%)`;
        resultEl.className = "btrk-calc-result btrk-calc-loss";
      } else {
        resultEl.textContent = "Even trade (0 difference)";
        resultEl.className = "btrk-calc-result btrk-calc-even";
      }
    }

    yoursInput.addEventListener("input", calculate);
    theirsInput.addEventListener("input", calculate);
  }

  // ============================================================
  // REX TIER: Server Size Indicator
  // ============================================================

  function initServerSizeIndicator() {
    if (!window.location.pathname.match(/\/games?\/(\d+)/i)) return;

    const gameInfo = document.querySelector(
      ".game-info, .game-details, #game-detail-container, .game-header, .place-info"
    );
    if (!gameInfo || gameInfo.querySelector(".btrkorone-server-indicator")) return;

    const indicator = document.createElement("div");
    indicator.className = "btrkorone-server-indicator";
    indicator.innerHTML = `
      <div class="btrk-server-bar">
        <span class="btrk-server-label">Server Capacity</span>
        <div class="btrk-server-meter">
          <div class="btrk-server-fill" id="btrk-server-fill" style="width: 0%"></div>
        </div>
        <span class="btrk-server-count" id="btrk-server-count">-- / --</span>
      </div>
    `;
    gameInfo.appendChild(indicator);

    // Try to read player count from page
    const playerEl = document.querySelector(".player-count, .playing-count, [data-playing]");
    const maxEl = document.querySelector(".max-players, [data-max-players]");
    if (playerEl && maxEl) {
      const current = parseInt(playerEl.textContent) || parseInt(playerEl.dataset.playing) || 0;
      const max = parseInt(maxEl.textContent) || parseInt(maxEl.dataset.maxPlayers) || 50;
      const pct = Math.min((current / max) * 100, 100);

      document.getElementById("btrk-server-fill").style.width = pct + "%";
      document.getElementById("btrk-server-count").textContent = `${current} / ${max}`;

      // Color based on capacity
      const fill = document.getElementById("btrk-server-fill");
      if (pct > 80) fill.style.background = "#f44336";
      else if (pct > 50) fill.style.background = "#ffd700";
      else fill.style.background = "#4caf50";
    }
  }

  // ============================================================
  // REX TIER: Friend Activity Feed
  // ============================================================

  function initFriendActivityFeed() {
    if (window.location.pathname !== "/" && !window.location.pathname.includes("/home")) return;

    const main = document.querySelector(
      ".main-content, #content, main, .content-container, .home-content"
    );
    if (!main || document.querySelector(".btrkorone-activity-feed")) return;

    const feed = document.createElement("aside");
    feed.className = "btrkorone-activity-feed";
    feed.innerHTML = `
      <div class="btrk-feed-header">
        <h3>Friend Activity</h3>
        <span class="btrk-feed-badge">REX</span>
      </div>
      <div class="btrk-feed-list" id="btrk-feed-list">
        <p class="btrk-feed-empty">Loading friend activity...</p>
      </div>
    `;
    main.appendChild(feed);

    // Try to populate from page data
    const friendElements = document.querySelectorAll(".friend-online, .friend-playing, [data-friend-status]");
    if (friendElements.length > 0) {
      const listEl = document.getElementById("btrk-feed-list");
      listEl.innerHTML = "";
      friendElements.forEach((el, i) => {
        if (i >= 8) return; // Limit to 8
        const name = el.querySelector(".friend-name, .username")?.textContent || "Friend";
        const status = el.dataset.friendStatus || el.querySelector(".status")?.textContent || "Online";
        const item = document.createElement("div");
        item.className = "btrk-feed-item";
        item.innerHTML = `<span class="btrk-feed-name">${name}</span><span class="btrk-feed-status">${status}</span>`;
        listEl.appendChild(item);
      });
    }
  }

  // ============================================================
  // REX TIER: Notifications Popup
  // ============================================================

  function initNotificationsPopup() {
    if (document.querySelector(".btrkorone-notif-popup")) return;

    const notifBtn = document.querySelector(
      ".notification-btn, .notifications, #notifications-icon, .notif-icon, [data-notifications]"
    );
    if (!notifBtn) return;

    notifBtn.classList.add("btrkorone-notif-btn");
    notifBtn.style.position = "relative";

    const popup = document.createElement("div");
    popup.className = "btrkorone-notif-popup";
    popup.innerHTML = `
      <div class="btrk-notif-header">
        <h4>Notifications</h4>
        <button class="btrk-notif-clear">Clear All</button>
      </div>
      <div class="btrk-notif-list">
        <p class="btrk-notif-empty">No new notifications</p>
      </div>
    `;
    popup.style.display = "none";
    notifBtn.appendChild(popup);

    notifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = popup.style.display === "none";
      popup.style.display = isHidden ? "block" : "none";
    });

    document.addEventListener("click", (e) => {
      if (!popup.contains(e.target) && !notifBtn.contains(e.target)) {
        popup.style.display = "none";
      }
    });
  }
  // ============================================================
  // UTILITY: Format value for display
  // ============================================================

  function formatValue(val) {
    const num = Math.abs(val);
    const sign = val < 0 ? "-" : "";
    if (num >= 1000000) return sign + (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return sign + (num / 1000).toFixed(1) + "K";
    return sign + num.toLocaleString();
  }
})();
