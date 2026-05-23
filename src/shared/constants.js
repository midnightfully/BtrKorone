/**
 * BtrKorone - Shared Constants
 * Central configuration for the extension
 */

const BTRKORONE = {
  // Extension metadata
  NAME: "BtrKorone",
  VERSION: "1.0.0",

  // Korone platform URLs
  KORONE_BASE_URL: "https://www.korone.live",
  KORONE_API_URL: "https://api.korone.live",
  KORONE_ECONOMY_URL: "https://economy.korone.live",

  // Roblox API endpoints for gamepass verification
  ROBLOX_API: {
    INVENTORY: "https://inventory.roblox.com/v1/users/{userId}/items/GamePass/{gamepassId}",
    USER_PROFILE: "https://users.roblox.com/v1/users/{userId}",
    GAMEPASSES: "https://www.roblox.com/game-pass/"
  },

  // Premium tier definitions
  TIERS: {
    FREE: {
      id: 0,
      name: "Free",
      label: "BtrKorone Free",
      color: "#8e8e8e",
      badge: null
    },
    PLUS: {
      id: 1,
      name: "Plus",
      label: "BtrKorone+",
      color: "#4fc3f7",
      badge: "+",
      gamepassId: 100001, // Replace with actual Korone gamepass ID
      price: "One-time purchase"
    },
    PRO: {
      id: 2,
      name: "Pro",
      label: "BtrKorone Pro",
      color: "#ffd700",
      badge: "PRO",
      gamepassId: 100002, // Replace with actual Korone gamepass ID
      price: "One-time purchase"
    }
  },

  // Storage keys
  STORAGE_KEYS: {
    USER_ID: "btrkorone_user_id",
    PREMIUM_TIER: "btrkorone_premium_tier",
    PREMIUM_TOKEN: "btrkorone_premium_token",
    VERIFICATION_TIMESTAMP: "btrkorone_verified_at",
    SETTINGS: "btrkorone_settings",
    CACHED_USERNAME: "btrkorone_username"
  },

  // Verification settings
  VERIFICATION: {
    TOKEN_PREFIX: "BTRK-",
    PROFILE_TOKEN_FIELD: "description", // Roblox profile description field
    RECHECK_INTERVAL_HOURS: 24,
    ALARM_NAME: "btrkorone_recheck_premium"
  },

  // Default user settings
  DEFAULT_SETTINGS: {
    enabled: true,
    uiEnhancements: true,
    quickNavigation: true,
    tradeEnhancements: true,
    darkModeOverride: false,
    compactMode: false,
    showPremiumBadge: true,
    itemValueEstimates: true,
    profileEnhancements: true,
    catalogFilters: true,
    notificationsPopup: true
  },

  // Feature access by tier
  FEATURES: {
    // Free tier features
    FREE: [
      "uiEnhancements",
      "quickNavigation",
      "compactMode"
    ],
    // Plus tier adds
    PLUS: [
      "tradeEnhancements",
      "darkModeOverride",
      "profileEnhancements",
      "catalogFilters"
    ],
    // Pro tier adds
    PRO: [
      "itemValueEstimates",
      "notificationsPopup",
      "advancedTradeCalculator",
      "serverSizeIndicator",
      "friendActivityFeed"
    ]
  }
};

// Export for module usage (background service worker)
if (typeof globalThis !== "undefined" && typeof module === "undefined") {
  globalThis.BTRKORONE = BTRKORONE;
}
