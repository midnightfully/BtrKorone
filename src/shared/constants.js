/**
 * BtrKorone - Shared Constants & Feature Registry
 * Central configuration with modular feature toggle system
 * Tiers: Free, BtrKorone Plus, BtrKorone Rex
 */

const BTRKORONE = {
  NAME: "BtrKorone",
  VERSION: "2.0.0",

  // Korone platform URLs
  KORONE_BASE_URL: "https://www.korone.live",
  KORONE_API_URL: "https://api.korone.live",
  KORONE_ECONOMY_URL: "https://economy.korone.live",
  KORONE_GAMES_URL: "https://www.korone.live/games",

  // Roblox API endpoints for verification
  ROBLOX_API: {
    INVENTORY: "https://inventory.roblox.com/v1/users/{userId}/items/GamePass/{gamepassId}",
    USER_PROFILE: "https://users.roblox.com/v1/users/{userId}",
    USER_AVATAR_HEADSHOT: "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={userId}&size=150x150&format=Png&isCircular=true",
    GAMEPASSES: "https://www.roblox.com/game-pass/"
  },

  // Korone API endpoints
  KORONE_API_ENDPOINTS: {
    USER_PROFILE: "https://api.korone.live/api/users/{userId}",
    USER_ABOUT: "https://api.korone.live/api/users/{userId}/about",
    GAME_JOIN: "https://www.korone.live/games/{placeId}/play"
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
    CACHED_AVATAR_URL: "btrkorone_avatar_url",
    KORONE_USER_ID: "btrkorone_korone_user_id"
  },

  // Verification settings
  VERIFICATION: {
    TOKEN_PREFIX: "BTRK-",
    // Token goes in Korone About Me section
    PROFILE_TOKEN_FIELD: "description",
    RECHECK_INTERVAL_HOURS: 24,
    ALARM_NAME: "btrkorone_recheck_premium"
  },

  /**
   * FEATURE REGISTRY
   * Each feature has metadata: id, name, description, tier requirement, default state, category
   */
  FEATURE_REGISTRY: [
    // === FREE TIER FEATURES ===
    {
      id: "playButton",
      name: "Play Button",
      description: "Adds a play button to game pages that launches games instantly",
      tier: 0,
      category: "games",
      defaultEnabled: true
    },
    {
      id: "uiEnhancements",
      name: "UI Enhancements",
      description: "Modernizes cards, hover effects, and layout cleanup",
      tier: 0,
      category: "ui",
      defaultEnabled: true
    },
    {
      id: "quickNavigation",
      name: "Quick Navigation",
      description: "Sticky nav bar with keyboard shortcuts (Alt+key)",
      tier: 0,
      category: "navigation",
      defaultEnabled: true
    },
    {
      id: "compactMode",
      name: "Compact Mode",
      description: "Reduce spacing for information-dense browsing",
      tier: 0,
      category: "ui",
      defaultEnabled: false
    },

    // === PLUS TIER FEATURES ===
    {
      id: "tradeEnhancements",
      name: "Trade Enhancements",
      description: "Value indicators, trade summaries, and fairness display",
      tier: 1,
      category: "trading",
      defaultEnabled: true
    },
    {
      id: "tradeOverlay",
      name: "Trade Overlay",
      description: "Floating trade overlay with item comparison",
      tier: 1,
      category: "trading",
      defaultEnabled: true
    },
    {
      id: "darkModeOverride",
      name: "Dark Mode Override",
      description: "Force dark theme across all Korone pages",
      tier: 1,
      category: "ui",
      defaultEnabled: false
    },
    {
      id: "profileEnhancements",
      name: "Profile Enhancements",
      description: "Better date formatting, layout improvements on profiles",
      tier: 1,
      category: "profile",
      defaultEnabled: true
    },
    {
      id: "catalogFilters",
      name: "Catalog Filters",
      description: "Price range filtering and advanced sorting",
      tier: 1,
      category: "catalog",
      defaultEnabled: true
    },

    // === REX TIER FEATURES ===
    {
      id: "itemValueEstimates",
      name: "Item Value Estimates",
      description: "Estimated item values on catalog and inventory",
      tier: 2,
      category: "trading",
      defaultEnabled: true
    },
    {
      id: "advancedTradeCalculator",
      name: "Advanced Trade Calculator",
      description: "Full trade value calculator with profit/loss analysis",
      tier: 2,
      category: "trading",
      defaultEnabled: true
    },
    {
      id: "serverSizeIndicator",
      name: "Server Size Indicator",
      description: "Visual player count and capacity on game pages",
      tier: 2,
      category: "games",
      defaultEnabled: true
    },
    {
      id: "friendActivityFeed",
      name: "Friend Activity Feed",
      description: "See what friends are playing on your homepage",
      tier: 2,
      category: "social",
      defaultEnabled: true
    },
    {
      id: "notificationsPopup",
      name: "Notifications Popup",
      description: "Enhanced notification display with quick actions",
      tier: 2,
      category: "ui",
      defaultEnabled: true
    },
    {
      id: "showPremiumBadge",
      name: "Premium Badge",
      description: "Show your BtrKorone tier badge next to your username",
      tier: 1,
      category: "profile",
      defaultEnabled: true
    }
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
BTRKORONE.DEFAULT_SETTINGS = {
  enabled: true
};

// Helper: get features available at a given tier
BTRKORONE.getFeaturesForTier = function(tier) {
  return this.FEATURE_REGISTRY.filter(f => f.tier <= tier);
};

// Helper: check if a feature is accessible at a given tier
BTRKORONE.isFeatureAccessible = function(featureId, tier) {
  const feature = this.FEATURE_REGISTRY.find(f => f.id === featureId);
  if (!feature) return false;
  return tier >= feature.tier;
};

// Export for global scope
if (typeof globalThis !== "undefined" && typeof module === "undefined") {
  globalThis.BTRKORONE = BTRKORONE;
}
