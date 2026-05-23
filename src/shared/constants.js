/**
 * BtrKorone - Shared Constants & Feature Registry
 * Central configuration with modular feature toggle system
 * Tiers: Free, BtrKorone Plus, BtrKorone Rex
 */

const BTRKORONE = {
  NAME: "BtrKorone",
  VERSION: "2.1.0",

  // Korone/Pekora platform URLs
  KORONE_BASE_URL: "https://www.pekora.zip",
  KORONE_GAMES_URL: "https://www.pekora.zip/games",

  // Pekora API endpoints (mirrors Roblox API structure)
  PEKORA_API: {
    BASE: "https://www.pekora.zip/apisite",
    USER_PROFILE: "https://www.pekora.zip/apisite/users/v1/users/{userId}",
    USER_AUTHENTICATED: "https://www.pekora.zip/apisite/users/v1/users/authenticated",
    USER_AVATAR: "https://www.pekora.zip/Thumbs/Avatar.ashx?x=150&y=150&userId={userId}",
    USER_HEADSHOT: "https://www.pekora.zip/headshot-thumbnail/image?userId={userId}&width=150&height=150&format=png",
    USER_PROFILE_PAGE: "https://www.pekora.zip/users/{userId}/profile",
    INVENTORY: "https://www.pekora.zip/apisite/inventory/v2/users/{userId}/assets/collectibles?limit=100&sortOrder=Desc",
    TRADES_INBOUND: "https://www.pekora.zip/apisite/trades/v1/trades/inbound",
    GAME_JOIN: "https://www.pekora.zip/games/{placeId}/play"
  },

  // Roblox API (for gamepass verification only)
  ROBLOX_API: {
    INVENTORY: "https://inventory.roblox.com/v1/users/{userId}/items/GamePass/{gamepassId}",
    GAMEPASSES: "https://www.roblox.com/game-pass/"
  },

  // Premium tier definitions
  TIERS: {
    FREE: {
      id: 0,
      name: "Free",
      label: "BtrKorone Free",
      color: "#8e8e8e",
      badge: null,
      cssClass: "tier-free"
    },
    PLUS: {
      id: 1,
      name: "Plus",
      label: "BtrKorone+",
      color: "#4fc3f7",
      badge: "+",
      cssClass: "tier-plus",
      gamepassId: 100001, // Replace with actual Korone gamepass ID for Plus
      price: "One-time Robux purchase"
    },
    REX: {
      id: 2,
      name: "Rex",
      label: "BtrKorone Rex",
      color: "#ffd700",
      badge: "REX",
      cssClass: "tier-rex",
      gamepassId: 100002, // Replace with actual Korone gamepass ID for Rex
      price: "One-time Robux purchase"
    }
  },

  // Storage keys
  STORAGE_KEYS: {
    USER_ID: "btrkorone_user_id",
    PREMIUM_TIER: "btrkorone_premium_tier",
    PREMIUM_TOKEN: "btrkorone_premium_token",
    VERIFICATION_TIMESTAMP: "btrkorone_verified_at",
    SETTINGS: "btrkorone_settings",
    FEATURE_TOGGLES: "btrkorone_feature_toggles",
    CACHED_USERNAME: "btrkorone_username",
    CACHED_AVATAR_URL: "btrkorone_avatar_url"
  },

  // Verification settings
  VERIFICATION: {
    TOKEN_PREFIX: "BTRK-",
    RECHECK_INTERVAL_HOURS: 24,
    ALARM_NAME: "btrkorone_recheck_premium"
  },

  /**
   * FEATURE REGISTRY
   */
  FEATURE_REGISTRY: [
    // === FREE TIER FEATURES ===
    { id: "playButton", name: "Play Button", description: "Adds a play button to game pages that launches games instantly", tier: 0, category: "games", defaultEnabled: true },
    { id: "uiEnhancements", name: "UI Enhancements", description: "Modernizes cards, hover effects, and layout cleanup", tier: 0, category: "ui", defaultEnabled: true },
    { id: "quickNavigation", name: "Quick Navigation", description: "Sticky nav bar with keyboard shortcuts (Alt+key)", tier: 0, category: "navigation", defaultEnabled: true },
    { id: "compactMode", name: "Compact Mode", description: "Reduce spacing for information-dense browsing", tier: 0, category: "ui", defaultEnabled: false },

    // === PLUS TIER FEATURES ===
    { id: "tradeEnhancements", name: "Trade Enhancements", description: "Value indicators, trade summaries, and fairness display", tier: 1, category: "trading", defaultEnabled: true },
    { id: "tradeOverlay", name: "Trade Overlay", description: "Floating trade overlay with item comparison", tier: 1, category: "trading", defaultEnabled: true },
    { id: "darkModeOverride", name: "Dark Mode Override", description: "Force dark theme across all Korone pages", tier: 1, category: "ui", defaultEnabled: false },
    { id: "profileEnhancements", name: "Profile Enhancements", description: "Better date formatting, layout improvements on profiles", tier: 1, category: "profile", defaultEnabled: true },
    { id: "catalogFilters", name: "Catalog Filters", description: "Price range filtering and advanced sorting", tier: 1, category: "catalog", defaultEnabled: true },
    { id: "showPremiumBadge", name: "Premium Badge", description: "Show your BtrKorone tier badge next to your username", tier: 1, category: "profile", defaultEnabled: true },

    // === REX TIER FEATURES ===
    { id: "itemValueEstimates", name: "Item Value Estimates", description: "Estimated item values on catalog and inventory", tier: 2, category: "trading", defaultEnabled: true },
    { id: "advancedTradeCalculator", name: "Advanced Trade Calculator", description: "Full trade value calculator with profit/loss analysis", tier: 2, category: "trading", defaultEnabled: true },
    { id: "serverSizeIndicator", name: "Server Size Indicator", description: "Visual player count and capacity on game pages", tier: 2, category: "games", defaultEnabled: true },
    { id: "friendActivityFeed", name: "Friend Activity Feed", description: "See what friends are playing on your homepage", tier: 2, category: "social", defaultEnabled: true },
    { id: "notificationsPopup", name: "Notifications Popup", description: "Enhanced notification display with quick actions", tier: 2, category: "ui", defaultEnabled: true }
  ],

  // Feature categories for UI grouping
  FEATURE_CATEGORIES: {
    ui: { label: "Interface", icon: "palette" },
    navigation: { label: "Navigation", icon: "compass" },
    games: { label: "Games", icon: "gamepad" },
    trading: { label: "Trading", icon: "exchange" },
    catalog: { label: "Catalog", icon: "shopping" },
    profile: { label: "Profile", icon: "user" },
    social: { label: "Social", icon: "users" }
  }
};

// Computed: default toggle states from registry
BTRKORONE.DEFAULT_FEATURE_TOGGLES = {};
BTRKORONE.FEATURE_REGISTRY.forEach(f => {
  BTRKORONE.DEFAULT_FEATURE_TOGGLES[f.id] = f.defaultEnabled;
});

// Computed: default settings (extension-level)
BTRKORONE.DEFAULT_SETTINGS = { enabled: true };

// Helper: check if a feature is accessible at a given tier
BTRKORONE.isFeatureAccessible = function(featureId, tier) {
  const feature = this.FEATURE_REGISTRY.find(f => f.id === featureId);
  if (!feature) return false;
  return tier >= feature.tier;
};

if (typeof globalThis !== "undefined" && typeof module === "undefined") {
  globalThis.BTRKORONE = BTRKORONE;
}
