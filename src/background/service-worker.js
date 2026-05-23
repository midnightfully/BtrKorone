/**
 * BtrKorone - Background Service Worker
 * Handles premium verification, periodic rechecks, and message passing
 */

importScripts(
  "../shared/constants.js",
  "../shared/storage.js",
  "../shared/premium-verifier.js"
);

// --- Extension Install / Update ---
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[BtrKorone] Extension installed/updated:", details.reason);

  if (details.reason === "install") {
    // Initialize default settings on first install
    await BtrStorage.updateSettings(BTRKORONE.DEFAULT_SETTINGS);
    await BtrStorage.setPremiumTier(BTRKORONE.TIERS.FREE.id);
  }

  // Set up periodic premium recheck alarm
  chrome.alarms.create(BTRKORONE.VERIFICATION.ALARM_NAME, {
    periodInMinutes: BTRKORONE.VERIFICATION.RECHECK_INTERVAL_HOURS * 60
  });
});

// --- Alarm Handler (Periodic Recheck) ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === BTRKORONE.VERIFICATION.ALARM_NAME) {
    console.log("[BtrKorone] Running periodic premium recheck...");
    await performPeriodicRecheck();
  }
});

/**
 * Periodic background recheck of premium status
 */
async function performPeriodicRecheck() {
  const userId = await BtrStorage.getUserId();
  if (!userId) return;

  const currentTier = await BtrStorage.getPremiumTier();
  if (currentTier === BTRKORONE.TIERS.FREE.id) return; // No need to recheck free users

  try {
    const newTier = await PremiumVerifier.recheckOwnership(userId);
    await BtrStorage.setPremiumTier(newTier);
    await BtrStorage.setVerificationTimestamp(Date.now());

    if (newTier !== currentTier) {
      console.log(`[BtrKorone] Premium tier changed: ${currentTier} -> ${newTier}`);
      // Notify content scripts of tier change
      broadcastMessage({ type: "TIER_CHANGED", tier: newTier });
    }
  } catch (error) {
    console.error("[BtrKorone] Periodic recheck failed:", error);
  }
}

// --- Message Handler ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep message channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "GET_STATUS":
      return await getExtensionStatus();

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

    case "GET_FEATURE_ACCESS":
      return await getFeatureAccess();

    case "FORCE_RECHECK":
      await performPeriodicRecheck();
      return await getExtensionStatus();

    default:
      return { error: "Unknown message type" };
  }
}

/**
 * Get full extension status for popup/content scripts
 */
async function getExtensionStatus() {
  const userId = await BtrStorage.getUserId();
  const tier = await BtrStorage.getPremiumTier();
  const username = await BtrStorage.getCachedUsername();
  const settings = await BtrStorage.getSettings();
  const lastVerified = await BtrStorage.getVerificationTimestamp();

  const tierInfo = Object.values(BTRKORONE.TIERS).find(t => t.id === tier) || BTRKORONE.TIERS.FREE;

  return {
    userId,
    username,
    tier,
    tierInfo,
    settings,
    lastVerified,
    version: BTRKORONE.VERSION
  };
}

/**
 * Generate a verification token for the user
 */
async function handleGenerateToken(userId) {
  if (!userId || isNaN(userId)) {
    return { error: "Invalid User ID. Please provide a valid Roblox User ID." };
  }

  const token = PremiumVerifier.generateToken(userId);
  await BtrStorage.setUserId(userId);
  await BtrStorage.setToken(token);

  return {
    success: true,
    token,
    instructions: `Place this token anywhere in your Roblox profile description: ${token}`
  };
}

/**
 * Perform full premium verification
 */
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
    // Notify content scripts
    broadcastMessage({ type: "TIER_CHANGED", tier: result.tier });
  }

  return result;
}

/**
 * Logout / reset premium status
 */
async function handleLogout() {
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.USER_ID);
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.PREMIUM_TOKEN);
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.PREMIUM_TIER);
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.VERIFICATION_TIMESTAMP);
  await BtrStorage.remove(BTRKORONE.STORAGE_KEYS.CACHED_USERNAME);
  await BtrStorage.setPremiumTier(BTRKORONE.TIERS.FREE.id);

  broadcastMessage({ type: "TIER_CHANGED", tier: BTRKORONE.TIERS.FREE.id });

  return { success: true, message: "Logged out and premium status reset." };
}

/**
 * Get feature access map based on current tier
 */
async function getFeatureAccess() {
  const tier = await BtrStorage.getPremiumTier();
  let features = [...BTRKORONE.FEATURES.FREE];

  if (tier >= BTRKORONE.TIERS.PLUS.id) {
    features = [...features, ...BTRKORONE.FEATURES.PLUS];
  }
  if (tier >= BTRKORONE.TIERS.PRO.id) {
    features = [...features, ...BTRKORONE.FEATURES.PRO];
  }

  return { tier, features };
}

/**
 * Broadcast message to all Korone tabs
 */
function broadcastMessage(message) {
  chrome.tabs.query({ url: "*://*.korone.live/*" }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}
