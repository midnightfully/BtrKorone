/**
 * BtrKorone - Premium Features (non-trade)
 *
 * Trade-related features (overlay, enhancements, calculator) live in
 * trade-features.js because they share the Pekora trade API.
 *
 * This file handles: catalog filters, item value estimates, server indicator,
 * friend activity feed, notifications popup.
 */

(function BtrPremiumFeatures() {
  "use strict";

  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);

    const { tier } = window.__btrkorone;
    if (tier === 0) return;

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
      }
    }

    // === PLUS TIER ===
    if (hasFeature("catalogFilters")) initCatalogFilters();

    // === REX TIER ===
    if (hasFeature("itemValueEstimates")) initItemValueEstimates();
    if (hasFeature("serverSizeIndicator")) initServerSizeIndicator();
    if (hasFeature("friendActivityFeed")) initFriendActivityFeed();
    if (hasFeature("notificationsPopup")) initNotificationsPopup();
  }

  // ============================================================
  // PLUS: Catalog Filters
  // ============================================================

  function initCatalogFilters() {
    if (!window.location.pathname.includes("/catalog")) return;

    const container = document.querySelector(
      ".catalog-container, #catalog, .catalog-content, .catalog-page, body"
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
    document.querySelectorAll(".catalog-item, .item-card, .asset-card").forEach(item => {
      const priceEl = item.querySelector(".item-price, .price, .robux-price");
      if (!priceEl) return;
      const price = parseInt(priceEl.textContent.replace(/[^0-9]/g, "")) || 0;
      item.style.display = (price >= min && price <= max) ? "" : "none";
    });
  }

  function resetCatalogFilters() {
    const minEl = document.getElementById("btrk-price-min");
    const maxEl = document.getElementById("btrk-price-max");
    if (minEl) minEl.value = "";
    if (maxEl) maxEl.value = "";
    document.querySelectorAll(".catalog-item, .item-card, .asset-card").forEach(item => {
      item.style.display = "";
    });
  }

  // ============================================================
  // REX: Item Value Estimates
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
    items.forEach(item => {
      item.classList.add("btrk-valued");
      const nameEl = item.querySelector(".item-name, .asset-name, .name, [data-item-name], .card-title");
      const itemName = nameEl?.textContent?.trim() || nameEl?.dataset?.itemName || item.dataset?.itemName || "";

      const est = document.createElement("div");
      est.className = "btrkorone-value-estimate";

      if (itemName && typeof KoromonsAPI !== "undefined" && KoromonsAPI.isLoaded) {
        const data = KoromonsAPI.getItemData(itemName);
        if (data && data.value > 0) {
          est.innerHTML = `
            <span class="btrk-est-label">Val:</span>
            <span class="btrk-est-value">${formatValue(data.value)}</span>
            <span class="btrk-demand-badge" style="background:${KoromonsAPI.getDemandColor(data.demand)}">${data.demand}</span>
          `;
          est.title = `Value: ${data.value.toLocaleString()} | RAP: ${data.rap.toLocaleString()} | Demand: ${data.demand}`;
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
  // REX: Server Size Indicator
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

    const playerEl = document.querySelector(".player-count, .playing-count, [data-playing]");
    const maxEl = document.querySelector(".max-players, [data-max-players]");
    if (playerEl && maxEl) {
      const current = parseInt(playerEl.textContent) || parseInt(playerEl.dataset.playing) || 0;
      const max = parseInt(maxEl.textContent) || parseInt(maxEl.dataset.maxPlayers) || 50;
      const pct = Math.min((current / max) * 100, 100);
      document.getElementById("btrk-server-fill").style.width = pct + "%";
      document.getElementById("btrk-server-count").textContent = `${current} / ${max}`;
      const fill = document.getElementById("btrk-server-fill");
      if (pct > 80) fill.style.background = "#f44336";
      else if (pct > 50) fill.style.background = "#ffd700";
      else fill.style.background = "#4caf50";
    }
  }

  // ============================================================
  // REX: Friend Activity Feed
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
  }

  // ============================================================
  // REX: Notifications Popup
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

    notifBtn.addEventListener("click", e => {
      e.stopPropagation();
      popup.style.display = popup.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", e => {
      if (!popup.contains(e.target) && !notifBtn.contains(e.target)) {
        popup.style.display = "none";
      }
    });
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
