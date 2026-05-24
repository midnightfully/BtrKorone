/**
 * BtrKorone - Shared Constants & Feature Registry
 * Tiers: Free, BtrKorone Plus, BtrKorone Rex
 */

const BTRKORONE = {
  NAME: "BtrKorone",
  VERSION: "2.4.3",

  KORONE_BASE_URL: "https://www.pekora.zip",
  KORONE_GAMES_URL: "https://www.pekora.zip/games",

  PEKORA_API: {
    BASE: "https://www.pekora.zip/apisite",
    USER_PROFILE: "https://www.pekora.zip/apisite/users/v1/users/{userId}",
    USER_AUTHENTICATED: "https://www.pekora.zip/apisite/users/v1/users/authenticated",
    USER_HEADSHOT: "https://www.pekora.zip/headshot-thumbnail/image?userId={userId}&width=150&height=150&format=png",
    USER_PROFILE_PAGE: "https://www.pekora.zip/users/{userId}/profile",
    INVENTORY: "https://www.pekora.zip/apisite/inventory/v2/users/{userId}/assets/collectibles?limit=100&sortOrder=Desc",
    GAME_JOIN: "https://www.pekora.zip/games/{placeId}/play"
  },

  GAMEPASS_API: {
    INVENTORY: "https://www.pekora.zip/apisite/inventory/v1/users/{userId}/items/Asset/{gamepassId}"
  },

  TIERS: {
    FREE: {
      id: 0, name: "Free", label: "BtrKorone Free",
      color: "#8e8e8e", badge: null, cssClass: "tier-free"
    },
    PLUS: {
      id: 1, name: "Plus", label: "BtrKorone+",
      color: "#4fc3f7", badge: "+", cssClass: "tier-plus",
      gamepassId: 721129,
      gamepassUrl: "https://www.pekora.zip/catalog/721129/BtrKoronePlus",
      price: "One-time Robux purchase"
    },
    REX: {
      id: 2, name: "Rex", label: "BtrKorone Rex",
      color: "#ffd700", badge: "REX", cssClass: "tier-rex",
      gamepassId: 721215,
      gamepassUrl: "https://www.pekora.zip/catalog/721215/BtrKorone-Rex",
      price: "One-time Robux purchase"
    }
  },

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

  VERIFICATION: {
    TOKEN_PREFIX: "BTRK-",
    RECHECK_INTERVAL_HOURS: 24,
    ALARM_NAME: "btrkorone_recheck_premium"
  },

  /**
   * FEATURE REGISTRY - Stripped to working features only.
   * We add more features one at a time going forward.
   */
  FEATURE_REGISTRY: [
    // FREE TIER
    {
      id: "playButton",
      name: "Play Button",
      description: "Adds a play button to game cards that launches games instantly",
      tier: 0,
      category: "games",
      defaultEnabled: true
    },
    // REX TIER
    {
      id: "tradeModal",
      name: "Trade Modal Enhancement",
      description: "Adds Koromons values, demand ratings, and trade verdict inside the Pekora trade modal",
      tier: 2,
      category: "trading",
      defaultEnabled: true
    },
    {
      id: "tradeNotifications",
      name: "Trade Notifications",
      description: "Shows a desktop notification when you receive a new trade request",
      tier: 2,
      category: "trading",
      defaultEnabled: true
    }
  ],

  FEATURE_CATEGORIES: {
    games: { label: "Games", icon: "gamepad" },
    trading: { label: "Trading", icon: "exchange" }
  }
};

BTRKORONE.DEFAULT_FEATURE_TOGGLES = {};
BTRKORONE.FEATURE_REGISTRY.forEach(f => {
  BTRKORONE.DEFAULT_FEATURE_TOGGLES[f.id] = f.defaultEnabled;
});

BTRKORONE.DEFAULT_SETTINGS = { enabled: true };

BTRKORONE.isFeatureAccessible = function(featureId, tier) {
  const feature = this.FEATURE_REGISTRY.find(f => f.id === featureId);
  if (!feature) return false;
  return tier >= feature.tier;
};

if (typeof globalThis !== "undefined" && typeof module === "undefined") {
  globalThis.BTRKORONE = BTRKORONE;
}
