/**
 * BtrKorone - Content Script Main Entry
 *
 * Currently active features:
 *   - Play Button (Free tier) - overlays a play button on each Pekora game card
 *
 * Listens for tier changes and feature toggle events from the popup.
 */

(async function BtrKoroneInit() {
  "use strict";

  // ---- declarations hoisted to the top to avoid TDZ when called from
  // injectPlayButtons / observeForGameCards ----
  let gameCardObserver = null;
  let settings = null;
  let currentTier = 0;
  let featureToggles = {};
  let featureState = {};

  console.log("[BtrKorone] Initializing on:", window.location.href);

  try {
    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    if (status) {
      settings = status.settings;
      currentTier = status.tier;
      featureToggles = status.toggles || {};
    }

    const state = await chrome.runtime.sendMessage({ type: "GET_FEATURE_STATE" });
    if (state) featureState = state;
  } catch (e) {
    console.warn("[BtrKorone] Could not load state:", e);
    settings = BTRKORONE.DEFAULT_SETTINGS;
    featureToggles = BTRKORONE.DEFAULT_FEATURE_TOGGLES;
  }

  if (!settings || !settings.enabled) {
    console.log("[BtrKorone] Extension is disabled.");
    return;
  }

  // Build active feature list
  const activeFeatures = [];
  BTRKORONE.FEATURE_REGISTRY.forEach(f => {
    const accessible = currentTier >= f.tier;
    const enabled = featureToggles[f.id] !== false;
    if (accessible && enabled) activeFeatures.push(f.id);
  });

  // Expose global state for sibling content scripts
  window.__btrkorone = {
    settings,
    tier: currentTier,
    toggles: featureToggles,
    activeFeatures,
    hasFeature(id) { return activeFeatures.includes(id); },
    featureState
  };

  document.body.classList.add("btrkorone-active");
  document.body.dataset.btrkoroneTier = currentTier;

  // === PLAY BUTTON ===
  if (activeFeatures.includes("playButton")) {
    console.log("[BtrKorone/PlayButton] Enabled. Scanning for game cards...");
    injectPlayButtons();
    observeForGameCards();
  } else {
    console.log("[BtrKorone/PlayButton] Disabled.");
  }

  // === Background message listener ===
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
      if (tier >= f.tier && toggles[f.id] !== false) newActive.push(f.id);
    });
    window.__btrkorone.activeFeatures = newActive;
  }

  function handleDynamicToggle(featureId, enabled) {
    if (featureId === "playButton") {
      if (enabled) {
        injectPlayButtons();
        observeForGameCards();
      } else {
        removePlayButtons();
      }
    }
  }

  // ============================================================
  // PLAY BUTTON INJECTION
  // ============================================================

  /**
   * Pekora uses CSS Modules with hashed class names like `gameCardLink-0-2-148`.
   * We target by class-prefix and href shape, both of which are stable across
   * builds even when the numeric hashes change.
   */
  function injectPlayButtons() {
    const cards = findGameCards();

    let injected = 0;
    cards.forEach(card => {
      if (card.classList.contains("btrk-play-injected")) return;

      const placeId = extractPlaceId(card);
      if (!placeId) return;

      // Anchor the button inside the thumbnail container if we can find one,
      // otherwise fall back to the whole card.
      const anchor = findThumbAnchor(card) || card;
      if (anchor.querySelector(".btrkorone-play-btn")) {
        card.classList.add("btrk-play-injected");
        return;
      }
      if (getComputedStyle(anchor).position === "static") {
        anchor.style.position = "relative";
      }

      const btn = createPlayButton(placeId);
      anchor.appendChild(btn);
      card.classList.add("btrk-play-injected");
      injected++;
    });

    if (injected > 0) {
      console.log(`[BtrKorone/PlayButton] Injected ${injected} play button(s) (total cards seen: ${cards.length}).`);
    }

    // Also add a large play button on game detail pages
    injectDetailPagePlayButton();
  }

  /**
   * Pekora wraps each card's thumbnail in a div like:
   *   <div class="gameCardThumbContainer-0-2-149">...</div>
   * We anchor inside it so the play button lives over the icon, not over
   * the title or vote bar.
   */
  function findThumbAnchor(card) {
    return (
      card.querySelector('[class*="gameCardThumbContainer"]') ||
      card.querySelector('[class*="thumbContainer"]') ||
      card.querySelector('[class*="gameCardThumb"]') ||
      null
    );
  }

  /**
   * Find every Pekora game-card link on the page.
   * Combined approach so we work on home, /games, /games/groups, etc.
   */
  function findGameCards() {
    const set = new Set();
    document
      .querySelectorAll('a[class*="gameCardLink"], a[href^="/games/"]')
      .forEach(el => {
        if (el.classList.contains("btrkorone-quicknav-link")) return;
        // Filter to actual place links: /games/<id>/...
        const href = el.getAttribute("href") || "";
        if (/^\/games\/\d+/.test(href)) set.add(el);
      });
    return [...set];
  }

  function extractPlaceId(card) {
    if (card.dataset && card.dataset.gameId) return card.dataset.gameId;
    if (card.dataset && card.dataset.placeId) return card.dataset.placeId;

    const href = card.getAttribute && card.getAttribute("href");
    if (href) {
      const m = href.match(/\/games?\/(\d+)/i);
      if (m) return m[1];
    }
    if (card.tagName === "A" && card.href) {
      const m = card.href.match(/\/games?\/(\d+)/i);
      if (m) return m[1];
    }
    const inner = card.querySelector && card.querySelector('a[href^="/games/"]');
    if (inner) {
      const m = (inner.getAttribute("href") || "").match(/\/games?\/(\d+)/i);
      if (m) return m[1];
    }
    return null;
  }

  function createPlayButton(placeId) {
    const btn = document.createElement("button");
    btn.className = "btrkorone-play-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Launch this game");
    btn.title = "Play this game";
    btn.innerHTML = '<span class="play-icon">&#9654;</span>';
    btn.dataset.placeId = placeId;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      launchGame(placeId);
    });
    return btn;
  }

  function injectDetailPagePlayButton() {
    const pathMatch = window.location.pathname.match(/\/games?\/(\d+)/i);
    if (!pathMatch) return;
    const placeId = pathMatch[1];

    const detailContainer = document.querySelector(
      ".game-info, .game-details, #game-detail-container, .game-header, .place-info, [class*='gamePageContainer']"
    );
    if (!detailContainer) return;
    if (detailContainer.querySelector(".btrkorone-play-btn-large")) return;

    const btn = document.createElement("button");
    btn.className = "btrkorone-play-btn btrkorone-play-btn-large";
    btn.type = "button";
    btn.innerHTML = '<span class="play-icon">&#9654;</span> Play';
    btn.title = "Launch this game";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      launchGame(placeId);
    });
    detailContainer.appendChild(btn);
  }

  function launchGame(placeId) {
    const playUrl = `https://www.pekora.zip/games/${placeId}/play`;
    window.location.href = playUrl;
  }

  function removePlayButtons() {
    document.querySelectorAll(".btrkorone-play-btn").forEach(btn => btn.remove());
    document.querySelectorAll(".btrk-play-injected").forEach(el => {
      el.classList.remove("btrk-play-injected");
    });
  }

  // === MutationObserver for dynamically loaded game cards ===

  function observeForGameCards() {
    if (gameCardObserver) return; // already observing

    let scheduled = false;
    gameCardObserver = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      // Debounce to avoid hammering on fast re-renders
      requestAnimationFrame(() => {
        scheduled = false;
        if (window.__btrkorone && window.__btrkorone.hasFeature("playButton")) {
          injectPlayButtons();
        }
      });
    });

    gameCardObserver.observe(document.body, { childList: true, subtree: true });
    console.log("[BtrKorone/PlayButton] MutationObserver started.");
  }

  console.log("[BtrKorone] Loaded. Tier:", currentTier, "Active features:", activeFeatures.length, activeFeatures);
})();
