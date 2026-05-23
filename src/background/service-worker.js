/**
 * BtrKorone - Background Service Worker
 * Handles premium verification, feature toggles, avatar caching,
 * periodic rechecks, and message passing between popup/content scripts
 */

importScripts(
  "../shared/constants.js",
  "../shared/storage.js",
  "../shared/premium-verifier.js",
  "../shared/koromons-api.js"
);

// === Extension Install / Update ===
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[BtrKorone] Extension installed/updated:", details.reason);

  if (details.reason === "install") {
    await BtrStorage.updateSettings(BTRKORONE.DEFAULT_SETTINGS);
    await BtrStorage.setFeatureToggles(BTRKORONE.DEFAULT_FEATURE_TOGGLES);
    await BtrStorage.setPremiumTier(BTRKORONE.TIERS.FREE.id);
  }

  // Set up periodic premium recheck alarm
  chrome.alarms.create(BTRKORONE.VERIFICATION.ALARM_NAME, {
    periodInMinutes: BTRKORONE.VERIFICATION.RECHECK_INTERVAL_HOURS * 60
  });

  // Set up Koromons cache refresh alarm (every 30 min)
  chrome.alarms.create("btrkorone_koromons_refresh", {
    periodInMinutes: 30
  });

  // Initial Koromons cache load
  KoromonsAPI.refresh();
});

// === Alarm Handler (Periodic Recheck) ===
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === BTRKORONE.VERIFICATION.ALARM_NAME) {
    console.log("[BtrKorone] Running periodic premium recheck...");
    await performPeriodicRecheck();
  }
  if (alarm.name === "btrkorone_koromons_refresh") {
    console.log("[BtrKorone] Refreshing Koromons item cache...");
    await KoromonsAPI.refresh();
  }
});

async function performPeriodicRecheck() {
  const userId = await BtrStorage.getUserId();
  if (!userId) return;

  const currentTier = await BtrStorage.getPremiumTier();
  if (currentTier === BTRKORONE.TIERS.FREE.id) return;

  try {
    const newTier = await PremiumVerifier.recheckOwnership(userId);
    await BtrStorage.setPremiumTier(newTier);
    await BtrStorage.setVerificationTimestamp(Date.now());

    if (newTier !== currentTier) {
      console.log(`[BtrKorone] Premium tier changed: ${currentTier} -> ${newTier}`);
      broadcastMessage({ type: "TIER_CHANGED", tier: newTier });
    }

    // Refresh avatar on recheck
    const avatarUrl = await PremiumVerifier.fetchAvatarUrl(userId);
    if (avatarUrl) {
      await BtrStorage.setCachedAvatarUrl(avatarUrl);
    }
  } catch (error) {
    console.error("[BtrKorone] Periodic recheck failed:", error);
  }
}

// === Message Handler ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "GET_STATUS":
      return await BtrStorage.getFullStatus();

    case "GET_FEATURE_STATE":
      return await BtrStorage.getFullFeatureState();

    case "TOGGLE_FEATURE":
      return await handleToggleFeature(message.featureId, message.enabled);

    case "SET_FEATURE_TOGGLES":
      return await handleSetFeatureToggles(message.toggles);

    case "GENERATE_TOKEN":
      return await handleGenerateToken(message.userId);

    case "VERIFY_PREMIUM":
      return await handleVerifyPremium(message.userId, message.token);

    case "GET_SETTINGS":
      return await BtrStorage.getSettings();

    case "UPDATE_SETTINGS":
      await BtrStorage.updateSettings(message.settings);
      broadcastMessage({ type: "SETTINGS_UPDATED", settings: message.settings });
      return { success: true };

    case "LOGOUT":
      return await handleLogout();

    case "FORCE_RECHECK":
      await performPeriodicRecheck();
      return await BtrStorage.getFullStatus();

    case "FETCH_AVATAR":
      return await handleFetchAvatar(message.userId);

    default:
      return { error: "Unknown message type" };
  }
}

// === Feature Toggle Handling ===

async function handleToggleFeature(featureId, enabled) {
  if (!featureId) return { error: "Missing featureId" };

  await BtrStorage.setFeatureToggle(featureId, enabled);
  broadcastMessage({ type: "FEATURE_TOGGLED", featureId, enabled });
  return { success: true, featureId, enabled };
}

async function handleSetFeatureToggles(toggles) {
  if (!toggles) return { error: "Missing toggles map" };

  await BtrStorage.setFeatureToggles(toggles);
  broadcastMessage({ type: "FEATURES_UPDATED", toggles });
  return { success: true };
}

// === Token Generation ===

async function handleGenerateToken(userId) {
  if (!userId || isNaN(userId)) {
    return { error: "Invalid User ID. Please provide a valid Roblox User ID." };
  }

  const token = PremiumVerifier.generateToken(userId);
  await BtrStorage.setUserId(userId);
  await BtrStorage.setToken(token);

  // Also fetch and cache avatar immediately
  const avatarUrl = await PremiumVerifier.fetchAvatarUrl(userId);
  if (avatarUrl) {
    await BtrStorage.setCachedAvatarUrl(avatarUrl);
  }

  // Fetch username from Roblox
  const profile = await PremiumVerifier.fetchRobloxProfile(userId);
  if (profile && profile.name) {
    await BtrStorage.setCachedUsername(profile.name);
  }

  return {
    success: true,
    token,
    avatarUrl,
    username: profile ? profile.name : null,
    instructions: `Place this token in your Korone About Me section: ${token}`
  };
}

// === Premium Verification ===

async function handleVerifyPremium(userId, token) {
  if (!userId || !token) {
    return { error: "Missing userId or token for verification." };
  }

  const result = await PremiumVerifier.performFullVerification(userId, token);

  if (result.success) {
    await BtrStorage.setPremiumTier(result.tier);
    await BtrStorage.setVerificationTimestamp(Date.now());
    if (result.username) {
      await BtrStorage.setCachedUsername(result.username);
    }
    if (result.avatarUrl) {
      await BtrStorage.setCachedAvatarUrl(result.avatarUrl);
    }
    broadcastMessage({ type: "TIER_CHANGED", tier: result.tier });
  } else {
    // Even on failure, cache username/avatar if we got them
    if (result.username) {
      await BtrStorage.setCachedUsername(result.username);
    }
    if (result.avatarUrl) {
      await BtrStorage.setCachedAvatarUrl(result.avatarUrl);
    }
  }

  return result;
}

// === Avatar Fetching ===

async function handleFetchAvatar(userId) {
  if (!userId) {
    const storedId = await BtrStorage.getUserId();
    if (!storedId) return { error: "No user ID available" };
    userId = storedId;
  }

  const avatarUrl = await PremiumVerifier.fetchAvatarUrl(userId);
  if (avatarUrl) {
    await BtrStorage.setCachedAvatarUrl(avatarUrl);
    return { success: true, avatarUrl };
  }
  return { error: "Could not fetch avatar" };
}

// === Logout ===

async function handleLogout() {
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.USER_ID);
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.PREMIUM_TOKEN);
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.PREMIUM_TIER);
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.VERIFICATION_TIMESTAMP);
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.CACHED_USERNAME);
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.CACHED_AVATAR_URL);
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.KORONE_USER_ID);
  await BtrStorage.setPremiumTier(BTRKORONE.TIERS.FREE.id);

  broadcastMessage({ type: "TIER_CHANGED", tier: BTRKORONE.TIERS.FREE.id });

  return { success: true, message: "Account unlinked and premium status reset." };
}

// === Broadcast to Korone Tabs ===

function broadcastMessage(message) {
  chrome.tabs.query({ url: "*://*.korone.live/*" }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}
