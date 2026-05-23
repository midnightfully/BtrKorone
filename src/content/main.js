/**
 * BtrKorone - Content Script Main Entry
 * Initializes all content script modules on Korone pages
 */

(async function BtrKoroneInit() {
  "use strict";

  console.log("[BtrKorone] Initializing on:", window.location.href);

  // Load current settings and tier
  let settings = null;
  let currentTier = 0;
  let featureAccess = [];

  try {
    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    if (status) {
      settings = status.settings;
      currentTier = status.tier;
    }

    const access = await chrome.runtime.sendMessage({ type: "GET_FEATURE_ACCESS" });
    if (access) {
      featureAccess = access.features;
    }
  } catch (e) {
    console.warn("[BtrKorone] Could not load settings:", e);
    settings = BTRKORONE.DEFAULT_SETTINGS;
  }

  if (!settings || !settings.enabled) {
    console.log("[BtrKorone] Extension is disabled.");
    return;
  }

  // Store state globally for other content scripts
  window.__btrkorone = {
    settings,
    tier: currentTier,
    features: featureAccess,
    hasFeature(name) {
      return featureAccess.includes(name) && settings[name] !== false;
    }
  };

  // Add body class for CSS targeting
  document.body.classList.add("btrkorone-active");
  document.body.dataset.btrkoroneTier = currentTier;

  if (settings.compactMode) {
    document.body.classList.add("btrkorone-compact");
  }

  if (settings.darkModeOverride && featureAccess.includes("darkModeOverride")) {
    document.body.classList.add("btrkorone-dark");
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case "TIER_CHANGED":
        window.__btrkorone.tier = message.tier;
        document.body.dataset.btrkoroneTier = message.tier;
        console.log("[BtrKorone] Tier updated to:", message.tier);
        break;
      case "SETTINGS_UPDATED":
        Object.assign(window.__btrkorone.settings, message.settings);
        applyDynamicSettings(message.settings);
        break;
    }
  });

  function applyDynamicSettings(changed) {
    if ("compactMode" in changed) {
      document.body.classList.toggle("btrkorone-compact", changed.compactMode);
    }
    if ("darkModeOverride" in changed) {
      document.body.classList.toggle("btrkorone-dark", changed.darkModeOverride);
    }
    if ("enabled" in changed && !changed.enabled) {
      document.body.classList.remove("btrkorone-active");
    }
  }

  console.log("[BtrKorone] Loaded successfully. Tier:", currentTier, "Features:", featureAccess.length);
})();
