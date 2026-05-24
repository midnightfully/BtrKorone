/**
 * BtrKorone - Content Script Main Entry
 * Initializes feature system, injects play button immediately,
 * listens for dynamic feature toggle changes from background
 */

(async function BtrKoroneInit() {
  "use strict";

  console.log("[BtrKorone] Initializing on:", window.location.href);

  let settings = null;
  let currentTier = 0;
  let featureToggles = {};
  let featureState = {};

  try {
    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    if (status) {
      settings = status.settings;
      currentTier = status.tier;
      featureToggles = status.toggles || {};
    }

    const state = await chrome.runtime.sendMessage({ type: "GET_FEATURE_STATE" });
    if (state) {
      featureState = state;
    }
  } catch (e) {
    console.warn("[BtrKorone] Could not load state:", e);
    settings = BTRKORONE.DEFAULT_SETTINGS;
    featureToggles = BTRKORONE.DEFAULT_FEATURE_TOGGLES;
  }

  if (!settings || !settings.enabled) {
    console.log("[BtrKorone] Extension is disabled.");
    return;
  }

  // Build active features list
  const activeFeatures = [];
  BTRKORONE.FEATURE_REGISTRY.forEach(f => {
    const accessible = currentTier >= f.tier;
    const enabled = featureToggles[f.id] !== false;
    if (accessible && enabled) activeFeatures.push(f.id);
  });

  // Expose global state for other content scripts
  window.__btrkorone = {
    settings,
    tier: currentTier,
    toggles: featureToggles,
    activeFeatures,
    hasFeature(id) {
      return activeFeatures.includes(id);
    },
    featureState
  };

  // Add body classes for CSS targeting
  document.body.classList.add("btrkorone-active");
  document.body.dataset.btrkoroneTier = currentTier;

  if (activeFeatures.includes("darkModeOverride")) {
    document.body.classList.add("btrkorone-dark");
  }

  // === PLAY BUTTON: Inject immediately without waiting for other modules ===
  if (activeFeatures.includes("playButton")) {
    injectPlayButtons();
    // Also observe for dynamically loaded game cards
    observeForGameCards();
  }

  // Listen for messages from background (tier changes, feature toggles)
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case "TIER_CHANGED":
        window.__btrkorone.tier = message.tier;
        document.body.dataset.btrkoroneTier = message.tier;
        recalculateActiveFeatures(message.tier);
        break;

      case "SETTINGS_UPDATED":
        Object.assign(window.__btrkorone.settings, message.settings);
        if ("enabled" in message.settings && !message.settings.enabled) {
          document.body.classList.remove("btrkorone-active");
        }
        break;

      case "FEATURE_TOGGLED":
        window.__btrkorone.toggles[message.featureId] = message.enabled;
        recalculateActiveFeatures(window.__btrkorone.tier);
        handleDynamicToggle(message.featureId, message.enabled);
        break;

      case "FEATURES_UPDATED":
        Object.assign(window.__btrkorone.toggles, message.toggles);
        recalculateActiveFeatures(window.__btrkorone.tier);
        break;
    }
  });

  function recalculateActiveFeatures(tier) {
    const toggles = window.__btrkorone.toggles;
    const newActive = [];
    BTRKORONE.FEATURE_REGISTRY.forEach(f => {
      if (tier >= f.tier && toggles[f.id] !== false) {
        newActive.push(f.id);
      }
    });
    window.__btrkorone.activeFeatures = newActive;

    // Update body classes
    document.body.classList.toggle("btrkorone-dark", newActive.includes("darkModeOverride"));
  }

  function handleDynamicToggle(featureId, enabled) {
    // Handle play button toggle without page refresh
    if (featureId === "playButton") {
      if (enabled) {
        injectPlayButtons();
        observeForGameCards();
      } else {
        removePlayButtons();
      }
    }
  }

  // === Play Button Injection ===

  function injectPlayButtons() {
    // Target game cards - broad selectors for Pekora's Roblox-style layout
    const gameCards = document.querySelectorAll(
      ".game-card:not(.btrk-play-injected), " +
      ".game-item:not(.btrk-play-injected), " +
      "[data-game-id]:not(.btrk-play-injected), " +
      ".game-card-container:not(.btrk-play-injected), " +
      ".game-card-link:not(.btrk-play-injected), " +
      ".game-card-thumb-container:not(.btrk-play-injected), " +
      ".slide-item-container:not(.btrk-play-injected), " +
      "a[href*='/games/']:not(.btrk-play-injected):not(.btrkorone-quicknav-link)"
    );

    gameCards.forEach(card => {
      card.classList.add("btrk-play-injected");
      const placeId = extractPlaceId(card);
      if (!placeId) return;

      const btn = createPlayButton(placeId);
      card.style.position = "relative";
      card.appendChild(btn);
    });

    // Also inject on game detail pages
    injectDetailPagePlayButton();
  }

  function injectDetailPagePlayButton() {
    // Check if we're on a game detail page
    const pathMatch = window.location.pathname.match(/\/games?\/(\d+)/i);
    if (!pathMatch) return;

    const placeId = pathMatch[1];
    const detailContainer = document.querySelector(
      ".game-info, .game-details, #game-detail-container, .game-header, .place-info"
    );
    if (!detailContainer) return;
    if (detailContainer.querySelector(".btrkorone-play-btn")) return;

    const btn = document.createElement("button");
    btn.className = "btrkorone-play-btn btrkorone-play-btn-large";
    btn.innerHTML = '<span class="play-icon">&#9654;</span> Play';
    btn.title = "Launch this game";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      launchGame(placeId);
    });

    detailContainer.appendChild(btn);
  }

  function createPlayButton(placeId) {
    const btn = document.createElement("button");
    btn.className = "btrkorone-play-btn";
    btn.innerHTML = '<span class="play-icon">&#9654;</span>';
    btn.title = "Play this game";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      launchGame(placeId);
    });
    return btn;
  }

  function launchGame(placeId) {
    // Navigate to the Pekora game play URL
    const playUrl = `https://www.pekora.zip/games/${placeId}/play`;
    window.location.href = playUrl;
  }

  function extractPlaceId(card) {
    // Try data attributes
    if (card.dataset.gameId) return card.dataset.gameId;
    if (card.dataset.placeId) return card.dataset.placeId;
    if (card.dataset.id) return card.dataset.id;

    // Try href from links inside the card
    const link = card.querySelector("a[href*='/games/'], a[href*='/game/']");
    if (link) {
      const match = link.href.match(/\/games?\/(\d+)/i);
      if (match) return match[1];
    }

    // Try the card itself if it's a link
    if (card.tagName === "A" && card.href) {
      const match = card.href.match(/\/games?\/(\d+)/i);
      if (match) return match[1];
    }

    // Try parent links
    const parentLink = card.closest("a[href*='/games/']");
    if (parentLink) {
      const match = parentLink.href.match(/\/games?\/(\d+)/i);
      if (match) return match[1];
    }

    return null;
  }

  function removePlayButtons() {
    document.querySelectorAll(".btrkorone-play-btn").forEach(btn => btn.remove());
    document.querySelectorAll(".btrk-play-injected").forEach(el => {
      el.classList.remove("btrk-play-injected");
    });
  }

  // === MutationObserver for dynamically loaded game cards ===

  let gameCardObserver = null;

  function observeForGameCards() {
    if (gameCardObserver) return; // Already observing

    gameCardObserver = new MutationObserver((mutations) => {
      let shouldInject = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldInject = true;
          break;
        }
      }
      if (shouldInject && window.__btrkorone.hasFeature("playButton")) {
        injectPlayButtons();
      }
    });

    gameCardObserver.observe(document.body, { childList: true, subtree: true });
  }

  console.log("[BtrKorone] Loaded. Tier:", currentTier, "Active features:", activeFeatures.length);
})();
