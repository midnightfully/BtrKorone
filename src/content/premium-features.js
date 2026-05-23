/**
 * BtrKorone - Premium Features
 * Features exclusive to BtrKorone+ and BtrKorone Pro tiers
 */

(function BtrPremiumFeatures() {
  "use strict";

  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);

    const { hasFeature, tier } = window.__btrkorone;
    if (tier === 0) return; // No premium features for free tier

    init();
  }, 100);

  function init() {
    const { hasFeature } = window.__btrkorone;

    // Plus tier features
    if (hasFeature("tradeEnhancements")) {
      initTradeEnhancements();
    }
    if (hasFeature("catalogFilters")) {
      initCatalogFilters();
    }

    // Pro tier features
    if (hasFeature("itemValueEstimates")) {
      initItemValueEstimates();
    }
    if (hasFeature("notificationsPopup")) {
      initNotificationsPopup();
    }
    if (hasFeature("serverSizeIndicator")) {
      initServerSizeIndicator();
    }
    if (hasFeature("friendActivityFeed")) {
      initFriendActivityFeed();
    }
  }

  // ======== PLUS TIER FEATURES ========

  /**
   * Trade Enhancements - Better trade interface with value indicators
   */
  function initTradeEnhancements() {
    if (!window.location.pathname.includes("/trade")) return;

    // Observe trade windows for items being added
    const observer = new MutationObserver(() => {
      enhanceTradeItems();
    });

    const tradeContainer = document.querySelector(
      ".trade-container, #trade-window, .trade-content"
    );
    if (tradeContainer) {
      observer.observe(tradeContainer, { childList: true, subtree: true });
      enhanceTradeItems();
    }
  }

  function enhanceTradeItems() {
    const tradeItems = document.querySelectorAll(
      ".trade-item:not(.btrk-trade-enhanced)"
    );

    tradeItems.forEach((item) => {
      item.classList.add("btrk-trade-enhanced");
      item.classList.add("btrkorone-trade-item");

      // Add value indicator placeholder
      const valueTag = document.createElement("div");
      valueTag.className = "btrkorone-value-tag";
      valueTag.textContent = "---"; // Would fetch real value from API
      item.appendChild(valueTag);
    });

    // Add trade summary
    addTradeSummary();
  }

  function addTradeSummary() {
    const existingSummary = document.querySelector(".btrkorone-trade-summary");
    if (existingSummary) existingSummary.remove();

    const tradeWindow = document.querySelector(
      ".trade-container, #trade-window, .trade-content"
    );
    if (!tradeWindow) return;

    const summary = document.createElement("div");
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

  /**
   * Catalog Filters - Advanced filtering for the catalog page
   */
  function initCatalogFilters() {
    if (!window.location.pathname.includes("/catalog")) return;

    const catalogContainer = document.querySelector(
      ".catalog-container, #catalog, .catalog-content"
    );
    if (!catalogContainer) return;

    // Add filter bar
    const filterBar = document.createElement("div");
    filterBar.className = "btrkorone-catalog-filters";
    filterBar.innerHTML = `
      <div class="btrk-filter-group">
        <label>Price Range:</label>
        <input type="number" class="btrk-filter-input" id="btrk-price-min" placeholder="Min">
        <span>-</span>
        <input type="number" class="btrk-filter-input" id="btrk-price-max" placeholder="Max">
      </div>
      <div class="btrk-filter-group">
        <label>Sort:</label>
        <select class="btrk-filter-select" id="btrk-sort">
          <option value="default">Default</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
        </select>
      </div>
      <button class="btrk-filter-btn" id="btrk-apply-filters">Apply</button>
      <button class="btrk-filter-btn btrk-filter-reset" id="btrk-reset-filters">Reset</button>
    `;

    catalogContainer.prepend(filterBar);

    // Filter logic
    document.getElementById("btrk-apply-filters")?.addEventListener("click", applyCatalogFilters);
    document.getElementById("btrk-reset-filters")?.addEventListener("click", resetCatalogFilters);
  }

  function applyCatalogFilters() {
    const minPrice = parseInt(document.getElementById("btrk-price-min")?.value) || 0;
    const maxPrice = parseInt(document.getElementById("btrk-price-max")?.value) || Infinity;

    const items = document.querySelectorAll(".catalog-item, .item-card");
    items.forEach((item) => {
      const priceEl = item.querySelector(".item-price, .price");
      if (!priceEl) return;

      const price = parseInt(priceEl.textContent.replace(/[^0-9]/g, "")) || 0;
      item.style.display = (price >= minPrice && price <= maxPrice) ? "" : "none";
    });
  }

  function resetCatalogFilters() {
    document.getElementById("btrk-price-min").value = "";
    document.getElementById("btrk-price-max").value = "";
    document.getElementById("btrk-sort").value = "default";

    const items = document.querySelectorAll(".catalog-item, .item-card");
    items.forEach((item) => {
      item.style.display = "";
    });
  }

  // ======== PRO TIER FEATURES ========

  /**
   * Item Value Estimates - Show estimated values on items
   */
  function initItemValueEstimates() {
    const items = document.querySelectorAll(
      ".item-card:not(.btrk-valued), .catalog-item:not(.btrk-valued), .inventory-item:not(.btrk-valued)"
    );

    items.forEach((item) => {
      item.classList.add("btrk-valued");

      const valueEstimate = document.createElement("div");
      valueEstimate.className = "btrkorone-value-estimate";
      valueEstimate.innerHTML = `<span class="btrk-est-label">Est:</span> <span class="btrk-est-value">---</span>`;
      item.appendChild(valueEstimate);
    });

    // Observe for new items
    const observer = new MutationObserver(() => {
      initItemValueEstimates();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Notifications Popup - Enhanced notification display
   */
  function initNotificationsPopup() {
    const existingPopup = document.querySelector(".btrkorone-notif-popup");
    if (existingPopup) return;

    // Create notification bell enhancement
    const notifBtn = document.querySelector(
      ".notification-btn, .notifications, #notifications-icon"
    );
    if (!notifBtn) return;

    notifBtn.classList.add("btrkorone-notif-btn");

    // Create popup container
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
      popup.style.display = popup.style.display === "none" ? "block" : "none";
    });

    document.addEventListener("click", () => {
      popup.style.display = "none";
    });
  }

  /**
   * Server Size Indicator - Show player count on game pages
   */
  function initServerSizeIndicator() {
    if (!window.location.pathname.match(/\/games?\/\d+/i)) return;

    const gameInfo = document.querySelector(
      ".game-info, .game-details, #game-detail-container"
    );
    if (!gameInfo) return;

    const indicator = document.createElement("div");
    indicator.className = "btrkorone-server-indicator";
    indicator.innerHTML = `
      <div class="btrk-server-bar">
        <span class="btrk-server-label">Server Capacity</span>
        <div class="btrk-server-meter">
          <div class="btrk-server-fill" style="width: 0%"></div>
        </div>
        <span class="btrk-server-count">-- / --</span>
      </div>
    `;
    gameInfo.appendChild(indicator);
  }

  /**
   * Friend Activity Feed - Show what friends are doing
   */
  function initFriendActivityFeed() {
    if (window.location.pathname !== "/" && !window.location.pathname.includes("/home")) return;

    const mainContent = document.querySelector(
      ".main-content, #content, main, .content-container"
    );
    if (!mainContent) return;

    const existingFeed = document.querySelector(".btrkorone-activity-feed");
    if (existingFeed) return;

    const feed = document.createElement("aside");
    feed.className = "btrkorone-activity-feed";
    feed.innerHTML = `
      <div class="btrk-feed-header">
        <h3>Friend Activity</h3>
        <button class="btrk-feed-refresh" title="Refresh">Refresh</button>
      </div>
      <div class="btrk-feed-list">
        <p class="btrk-feed-empty">Loading friend activity...</p>
      </div>
    `;
    mainContent.appendChild(feed);
  }
})();
