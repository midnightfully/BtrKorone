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

    case "LINK_ACCOUNT":
      return await handleLinkAccount(message.userId, message.token);

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

    case "GET_CURRENT_PEKORA_USER":
      return await handleGetCurrentPekoraUser();

    default:
      return { error: "Unknown message type" };
  }
}

// === Detect Currently Logged-In Pekora User (no linking required) ===

async function handleGetCurrentPekoraUser() {
  try {
    const data = await PekoraAPI.getAuthenticatedUser();
    if (!data || !data.id) {
      return { loggedIn: false };
    }
    return {
      loggedIn: true,
      userId: data.id,
      username: data.name || data.username || data.displayName || null,
      displayName: data.displayName || null,
      avatarUrl: PekoraAPI.getAvatarUrl(data.id)
    };
  } catch (error) {
    console.warn("[BtrKorone] getAuthenticatedUser failed:", error);
    return { loggedIn: false, error: error.message };
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

// === Account Linking (no gamepass check) ===

async function handleLinkAccount(userId, token) {
  if (!userId || !token) {
    return { error: "Missing userId or token for account linking." };
  }

  const result = await PremiumVerifier.performAccountLink(userId, token);

  if (result.success) {
    // Cache identity but DO NOT touch the premium tier - that's the job of
    // the future "Verify Subscription" button.
    await BtrStorage.setVerificationTimestamp(Date.now());
    if (result.username) {
      await BtrStorage.setCachedUsername(result.username);
    }
    if (result.avatarUrl) {
      await BtrStorage.setCachedAvatarUrl(result.avatarUrl);
    }
  } else if (result.username || result.avatarUrl) {
    // Even on failure, cache anything we managed to get
    if (result.username) await BtrStorage.setCachedUsername(result.username);
    if (result.avatarUrl) await BtrStorage.setCachedAvatarUrl(result.avatarUrl);
  }

  return result;
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
//
// Notification format (RoPro-style "Trade Inbound" card):
//   - Icon:    Partner's avatar headshot (fetched + converted to a
//              data URL because chrome.notifications iconUrl needs
//              extension-local or data: URLs to render reliably).
//   - Title:   "Trade Inbound"
//   - Message: Partner / Your Value / Their Value (multi-line)
//   - Context: Loss/Gain/Even line, signed and color-prefixed
//   - Buttons: [Open] [Decline]
//
// We also stash partner+trade metadata in `notifTradeCache` keyed by
// notification ID so the button-click handler knows which trade to act
// on. The cache survives only for the SW's lifetime, so the handler
// also falls back to parsing the trade ID out of the notification ID
// if the SW was restarted between display and click.
// ============================================================

const TRADE_NOTIF_ALARM = "btrkorone_check_trades";
const SEEN_TRADE_IDS_KEY = "btrkorone_seen_trade_ids";
const TRADE_NOTIF_PREFIX = "btrk-trade-";
const SEEN_IDS_MAX = 200; // hard cap so storage doesn't grow forever

const TRADES_PAGE_URL = "https://www.pekora.zip/My/Trades.aspx";
const TRADE_DECLINE_URL = (id) =>
  `https://www.pekora.zip/apisite/trades/v1/trades/${id}/decline`;

const notifTradeCache = new Map(); // notifId -> { tradeId, partnerId }

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

  // Best-effort: ensure the Koromons catalog is loaded so value math is
  // accurate. If it fails we fall back to RAP-only sums.
  if (newTrades.length > 0 && typeof KoromonsAPI !== "undefined" && !KoromonsAPI.isLoaded) {
    try { await KoromonsAPI.load(); } catch (_) {}
  }

  // Wait for all notification creates so the SW doesn't get torn down
  // mid-fetch (avatar/detail fetches are async).
  await Promise.allSettled(newTrades.map(t => showTradeNotification(t)));

  if (newTrades.length > 0) {
    console.log(
      `[BtrKorone/TradeNotif] Notified for ${newTrades.length} new trade(s).`
    );
  }

  // Update the seen list - keep the most recent SEEN_IDS_MAX ids
  const merged = [...new Set([...currentIds, ...previouslySeen])].slice(0, SEEN_IDS_MAX);
  await chrome.storage.local.set({ [SEEN_TRADE_IDS_KEY]: merged });
}

/**
 * Build and display a rich "Trade Inbound" notification.
 *
 * Resilient to partial failure - if the trade detail or avatar fails
 * to fetch, we still show a notification (just with a fallback icon
 * and a short message instead of the value breakdown).
 */
async function showTradeNotification(trade) {
  const partnerName =
    (trade.user && (trade.user.displayName || trade.user.name || trade.user.username)) ||
    "Someone";
  const partnerId = trade.user && trade.user.id;
  const notifId = TRADE_NOTIF_PREFIX + trade.id;

  const myUserId = await BtrStorage.getUserId();

  // Fetch detail + avatar in parallel - both are independent.
  const [detail, iconDataUrl] = await Promise.all([
    PekoraAPI.getTradeDetail(trade.id).catch(() => null),
    fetchAvatarAsDataUrl(partnerId).catch(() => null)
  ]);

  let messageLines;
  let contextMessage = "";

  if (detail && myUserId) {
    const { myOffer, theirOffer } = PekoraAPI.splitTradeOffers(detail, Number(myUserId));
    const myAssets = (myOffer && myOffer.userAssets) || [];
    const theirAssets = (theirOffer && theirOffer.userAssets) || [];
    const myCalc = PekoraAPI.calculateOfferValue(myAssets);
    const theirCalc = PekoraAPI.calculateOfferValue(theirAssets);

    // myCalc.totalValue = what the user gives up; theirCalc.totalValue =
    // what they receive. Diff = receive - give. Positive diff = gain.
    const yourValue = myCalc.totalValue;
    const theirValue = theirCalc.totalValue;
    const diff = theirValue - yourValue;

    messageLines = [
      `Partner: ${partnerName}`,
      `Your Value: ${yourValue.toLocaleString()}`,
      `Their Value: ${theirValue.toLocaleString()}`
    ];

    if (diff > 0) {
      contextMessage = `Gain: +${diff.toLocaleString()} Value`;
    } else if (diff < 0) {
      // diff is negative, so it already prints with a minus sign.
      contextMessage = `Loss: ${diff.toLocaleString()} Value`;
    } else {
      contextMessage = `Even: 0 Value`;
    }
  } else {
    // Fallback: detail unavailable (auth issue, network, etc.)
    messageLines = [
      `Partner: ${partnerName}`,
      `New trade request received`
    ];
  }

  notifTradeCache.set(notifId, { tradeId: trade.id, partnerId });

  const options = {
    type: "basic",
    iconUrl: iconDataUrl || chrome.runtime.getURL("icons/icon128.png"),
    title: "Trade Inbound",
    message: messageLines.join("\n"),
    priority: 1,
    requireInteraction: false,
    buttons: [
      { title: "Open" },
      { title: "Decline" }
    ]
  };
  if (contextMessage) options.contextMessage = contextMessage;

  return new Promise(resolve => {
    chrome.notifications.create(notifId, options, () => resolve());
  });
}

/**
 * Fetch a Pekora user's headshot and return it as a data URL.
 *
 * `chrome.notifications.create` in MV3 service workers does not reliably
 * render http(s) iconUrls (the SW has no DOM/<img> to preload them), so
 * we fetch the bytes ourselves and inline them. FileReader is available
 * in the SW global scope.
 */
async function fetchAvatarAsDataUrl(userId) {
  if (!userId) return null;
  try {
    const url = PekoraAPI.getAvatarUrl(userId);
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

// ------------------------------------------------------------
// CSRF-aware POST helper for the SW
// ------------------------------------------------------------
// Pekora returns 403 + an `x-csrf-token` header when a state-changing
// POST is made without one. We retry once with that header. The token
// is cached per-SW so we don't pay the round-trip on every action.

let _swCsrfToken = "";

async function pekoraCsrfPost(url) {
  const tryPost = async (token) => {
    const headers = {
      "Accept": "application/json",
      "Content-Type": "application/json"
    };
    if (token) headers["x-csrf-token"] = token;
    return fetch(url, {
      method: "POST",
      credentials: "include",
      headers,
      body: "{}"
    });
  };

  let resp = await tryPost(_swCsrfToken);
  if (resp.status === 403) {
    const fresh = resp.headers.get("x-csrf-token");
    if (fresh && fresh !== _swCsrfToken) {
      _swCsrfToken = fresh;
      resp = await tryPost(_swCsrfToken);
    }
  }
  if (!resp.ok) {
    let msg = "HTTP " + resp.status;
    try {
      const j = await resp.json();
      if (j && j.errors && j.errors[0] && j.errors[0].message) {
        msg = j.errors[0].message;
      }
    } catch (_) {}
    throw new Error(msg);
  }
  return resp;
}

// ------------------------------------------------------------
// Notification click handlers
// ------------------------------------------------------------
// Clicking the body opens the trades page (same as before).
// Buttons: 0 = Open (open the trades page), 1 = Decline (POST decline).

chrome.notifications.onClicked.addListener((notifId) => {
  if (typeof notifId !== "string" || !notifId.startsWith(TRADE_NOTIF_PREFIX)) return;
  chrome.tabs.create({ url: TRADES_PAGE_URL });
  chrome.notifications.clear(notifId);
  notifTradeCache.delete(notifId);
});

chrome.notifications.onButtonClicked.addListener(async (notifId, buttonIndex) => {
  if (typeof notifId !== "string" || !notifId.startsWith(TRADE_NOTIF_PREFIX)) return;

  // Prefer the in-memory cache, but fall back to parsing the trade ID
  // out of the notification ID itself - this matters if the SW was
  // suspended between create and click.
  let tradeId = null;
  const cached = notifTradeCache.get(notifId);
  if (cached) {
    tradeId = cached.tradeId;
  } else {
    const parsed = Number(notifId.slice(TRADE_NOTIF_PREFIX.length));
    if (!Number.isNaN(parsed)) tradeId = parsed;
  }

  if (buttonIndex === 0) {
    // OPEN -> trades page (deep linking to a specific trade isn't
    // supported by Pekora's UI, so we just land on the list).
    chrome.tabs.create({ url: TRADES_PAGE_URL });
    chrome.notifications.clear(notifId);
    notifTradeCache.delete(notifId);
    return;
  }

  if (buttonIndex === 1) {
    // DECLINE -> POST against the trades API. We surface a small
    // follow-up notification to confirm success or report failure.
    if (!tradeId) {
      chrome.notifications.clear(notifId);
      return;
    }
    try {
      await pekoraCsrfPost(TRADE_DECLINE_URL(tradeId));
      chrome.notifications.clear(notifId);
      notifTradeCache.delete(notifId);
      chrome.notifications.create(notifId + "-declined", {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Trade Declined",
        message: "The trade was declined successfully.",
        priority: 0
      });
    } catch (err) {
      console.error("[BtrKorone/TradeNotif] Decline failed:", err);
      chrome.notifications.create(notifId + "-error", {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Decline Failed",
        message: (err && err.message) || "Could not decline the trade.",
        priority: 1
      });
    }
  }
});

// When the user toggles tradeNotifications off, reset the seen-IDs
// snapshot so re-enabling later doesn't blast them with backlog.
async function resetTradeNotificationState() {
  await chrome.storage.local.remove(SEEN_TRADE_IDS_KEY);
}

