/**
 * BtrKorone - Background Service Worker
 * Handles premium verification, feature toggles, avatar caching,
 * periodic rechecks, and message passing between popup/content scripts
 */

importScripts(
  "../shared/constants.js",
  "../shared/storage.js",
  "../shared/premium-verifier.js",
  "../shared/koromons-api.js",
  "../shared/pekora-api.js"
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

  // Set up trade-notification polling alarm (every 1 min - the MV3 minimum
  // for installed extensions). The actual check is gated by tier + toggle
  // inside the handler, so it's a no-op for users who don't have it on.
  chrome.alarms.create(TRADE_NOTIF_ALARM, { periodInMinutes: 1 });

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
  if (alarm.name === TRADE_NOTIF_ALARM) {
    await checkForNewTrades();
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
    const avatarUrl = PremiumVerifier.getAvatarUrl(userId);
    await BtrStorage.setCachedAvatarUrl(avatarUrl);
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

  // Side effects per feature
  if (featureId === "tradeNotifications" && !enabled) {
    await resetTradeNotificationState();
  }

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
    return { error: "Invalid User ID. Please provide a valid Korone User ID (number from your profile URL)." };
  }

  const token = PremiumVerifier.generateToken(userId);
  await BtrStorage.setUserId(userId);
  await BtrStorage.setToken(token);

  // Avatar URL is public (direct image link, no fetch needed)
  const avatarUrl = PremiumVerifier.getAvatarUrl(userId);
  await BtrStorage.setCachedAvatarUrl(avatarUrl);

  // Fetch username from Pekora (requires user to be logged in)
  const profile = await PremiumVerifier.fetchPekoraProfile(userId);
  const username = profile ? (profile.name || profile.username || profile.displayName) : null;
  if (username) {
    await BtrStorage.setCachedUsername(username);
  }

  return {
    success: true,
    token,
    avatarUrl,
    username,
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

  const avatarUrl = PremiumVerifier.getAvatarUrl(userId);
  await BtrStorage.setCachedAvatarUrl(avatarUrl);
  return { success: true, avatarUrl };
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

// ============================================================
// TRADE NOTIFICATIONS (Rex tier)
// ------------------------------------------------------------
// Poll Pekora's inbound-trades endpoint every minute. On the very
// first run we just record the IDs so we don't fire a wave of
// notifications for old trades. On subsequent runs we notify for
// any trade ID we haven't seen before.
// ============================================================

const TRADE_NOTIF_ALARM = "btrkorone_check_trades";
const SEEN_TRADE_IDS_KEY = "btrkorone_seen_trade_ids";
const TRADE_NOTIF_PREFIX = "btrk-trade-";
const SEEN_IDS_MAX = 200; // hard cap so storage doesn't grow forever

async function checkForNewTrades() {
  // Gate by tier + feature toggle so this is a cheap no-op for users
  // who haven't unlocked or have disabled the feature.
  const tier = await BtrStorage.getPremiumTier();
  if (tier < BTRKORONE.TIERS.REX.id) return;

  const toggles = await BtrStorage.getFeatureToggles();
  if (toggles.tradeNotifications === false) return;

  let result;
  try {
    result = await PekoraAPI.getInboundTrades();
  } catch (err) {
    console.warn("[BtrKorone/TradeNotif] Inbound trades fetch failed:", err);
    return;
  }
  if (!result || !Array.isArray(result.data)) return;

  const stored = await chrome.storage.local.get([SEEN_TRADE_IDS_KEY]);
  const previouslySeen = stored[SEEN_TRADE_IDS_KEY];
  const isFirstRun = !Array.isArray(previouslySeen);

  const currentIds = result.data.map(t => t.id).filter(id => typeof id === "number");

  if (isFirstRun) {
    // Don't notify on first run; just snapshot what's already there
    await chrome.storage.local.set({
      [SEEN_TRADE_IDS_KEY]: currentIds.slice(0, SEEN_IDS_MAX)
    });
    console.log(
      `[BtrKorone/TradeNotif] First run: snapshotted ${currentIds.length} existing trade(s); no notifications sent.`
    );
    return;
  }

  const newTrades = result.data.filter(
    t => typeof t.id === "number" && !previouslySeen.includes(t.id)
  );

  for (const trade of newTrades) {
    showTradeNotification(trade);
  }

  if (newTrades.length > 0) {
    console.log(
      `[BtrKorone/TradeNotif] Notified for ${newTrades.length} new trade(s).`
    );
  }

  // Update the seen list - keep the most recent SEEN_IDS_MAX ids
  const merged = [...new Set([...currentIds, ...previouslySeen])].slice(0, SEEN_IDS_MAX);
  await chrome.storage.local.set({ [SEEN_TRADE_IDS_KEY]: merged });
}

function showTradeNotification(trade) {
  const partnerName =
    (trade.user && (trade.user.name || trade.user.username)) || "Someone";
  const notifId = TRADE_NOTIF_PREFIX + trade.id;

  chrome.notifications.create(notifId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "New Trade Request",
    message: `${partnerName} sent you a trade request`,
    priority: 1,
    requireInteraction: false
  });
}

// Click on a trade notification -> open the Korone trades page
chrome.notifications.onClicked.addListener((notifId) => {
  if (typeof notifId !== "string" || !notifId.startsWith(TRADE_NOTIF_PREFIX)) return;
  chrome.tabs.create({ url: "https://www.pekora.zip/My/Trades.aspx" });
  chrome.notifications.clear(notifId);
});

// When the user toggles tradeNotifications off, reset the seen-IDs
// snapshot so re-enabling later doesn't blast them with backlog.
async function resetTradeNotificationState() {
  await chrome.storage.local.remove(SEEN_TRADE_IDS_KEY);
}

