/**
 * BtrKorone - Storage Utilities
 * Wrapper around chrome.storage.local with feature toggle persistence and avatar caching
 */

const BtrStorage = {
  // === Core Storage Operations ===

  async get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] ?? null);
      });
    });
  },

  async getMultiple(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        resolve(result);
      });
    });
  },

  async set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  },

  async setMultiple(obj) {
    return new Promise((resolve) => {
      chrome.storage.local.set(obj, resolve);
    });
  },

  async remove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, resolve);
    });
  },

  async clear() {
    return new Promise((resolve) => {
      chrome.storage.local.clear(resolve);
    });
  },

  // === User Identity ===

  async getUserId() {
    return this.get(BTRKORONE.STORAGE_KEYS.USER_ID);
  },

  async setUserId(userId) {
    return this.set(BTRKORONE.STORAGE_KEYS.USER_ID, userId);
  },

  async getKoroneUserId() {
    return this.get(BTRKORONE.STORAGE_KEYS.KORONE_USER_ID);
  },

  async setKoroneUserId(id) {
    return this.set(BTRKORONE.STORAGE_KEYS.KORONE_USER_ID, id);
  },

  async getCachedUsername() {
    return this.get(BTRKORONE.STORAGE_KEYS.CACHED_USERNAME);
  },

  async setCachedUsername(username) {
    return this.set(BTRKORONE.STORAGE_KEYS.CACHED_USERNAME, username);
  },

  // === Avatar Caching ===

  async getCachedAvatarUrl() {
    return this.get(BTRKORONE.STORAGE_KEYS.CACHED_AVATAR_URL);
  },

  async setCachedAvatarUrl(url) {
    return this.set(BTRKORONE.STORAGE_KEYS.CACHED_AVATAR_URL, url);
  },

  // === Premium Tier ===

  async getPremiumTier() {
    const tier = await this.get(BTRKORONE.STORAGE_KEYS.PREMIUM_TIER);
    return tier ?? BTRKORONE.TIERS.FREE.id;
  },

  async setPremiumTier(tierId) {
    return this.set(BTRKORONE.STORAGE_KEYS.PREMIUM_TIER, tierId);
  },

  async getToken() {
    return this.get(BTRKORONE.STORAGE_KEYS.PREMIUM_TOKEN);
  },

  async setToken(token) {
    return this.set(BTRKORONE.STORAGE_KEYS.PREMIUM_TOKEN, token);
  },

  async getVerificationTimestamp() {
    return this.get(BTRKORONE.STORAGE_KEYS.VERIFICATION_TIMESTAMP);
  },

  async setVerificationTimestamp(ts) {
    return this.set(BTRKORONE.STORAGE_KEYS.VERIFICATION_TIMESTAMP, ts);
  },

  // === Extension-Level Settings ===

  async getSettings() {
    const settings = await this.get(BTRKORONE.STORAGE_KEYS.SETTINGS);
    return { ...BTRKORONE.DEFAULT_SETTINGS, ...(settings || {}) };
  },

  async updateSettings(newSettings) {
    const current = await this.getSettings();
    const merged = { ...current, ...newSettings };
    return this.set(BTRKORONE.STORAGE_KEYS.SETTINGS, merged);
  },

  // === Feature Toggle System ===

  /**
   * Get all feature toggle states (merged with defaults)
   */
  async getFeatureToggles() {
    const saved = await this.get(BTRKORONE.STORAGE_KEYS.FEATURE_TOGGLES);
    return { ...BTRKORONE.DEFAULT_FEATURE_TOGGLES, ...(saved || {}) };
  },

  /**
   * Set a single feature toggle
   */
  async setFeatureToggle(featureId, enabled) {
    const toggles = await this.getFeatureToggles();
    toggles[featureId] = enabled;
    return this.set(BTRKORONE.STORAGE_KEYS.FEATURE_TOGGLES, toggles);
  },

  /**
   * Set multiple feature toggles at once
   */
  async setFeatureToggles(toggleMap) {
    const toggles = await this.getFeatureToggles();
    Object.assign(toggles, toggleMap);
    return this.set(BTRKORONE.STORAGE_KEYS.FEATURE_TOGGLES, toggles);
  },

  /**
   * Check if a specific feature is enabled AND accessible at the user's tier
   */
  async isFeatureActive(featureId) {
    const tier = await this.getPremiumTier();
    const toggles = await this.getFeatureToggles();
    const isAccessible = BTRKORONE.isFeatureAccessible(featureId, tier);
    const isEnabled = toggles[featureId] !== false;
    return isAccessible && isEnabled;
  },

  /**
   * Get full feature state map: { featureId: { enabled, accessible, meta } }
   */
  async getFullFeatureState() {
    const tier = await this.getPremiumTier();
    const toggles = await this.getFeatureToggles();
    const state = {};

    BTRKORONE.FEATURE_REGISTRY.forEach(feature => {
      state[feature.id] = {
        enabled: toggles[feature.id] !== false,
        accessible: tier >= feature.tier,
        active: (toggles[feature.id] !== false) && (tier >= feature.tier),
        meta: feature
      };
    });

    return state;
  },

  // === Bulk State Retrieval (for popup/content scripts) ===

  /**
   * Get everything needed for full extension status in one call
   */
  async getFullStatus() {
    const keys = Object.values(BTRKORONE.STORAGE_KEYS);
    const data = await this.getMultiple(keys);

    const tier = data[BTRKORONE.STORAGE_KEYS.PREMIUM_TIER] ?? BTRKORONE.TIERS.FREE.id;
    const settings = { ...BTRKORONE.DEFAULT_SETTINGS, ...(data[BTRKORONE.STORAGE_KEYS.SETTINGS] || {}) };
    const toggles = { ...BTRKORONE.DEFAULT_FEATURE_TOGGLES, ...(data[BTRKORONE.STORAGE_KEYS.FEATURE_TOGGLES] || {}) };

    const tierInfo = Object.values(BTRKORONE.TIERS).find(t => t.id === tier) || BTRKORONE.TIERS.FREE;

    return {
      userId: data[BTRKORONE.STORAGE_KEYS.USER_ID] || null,
      koroneUserId: data[BTRKORONE.STORAGE_KEYS.KORONE_USER_ID] || null,
      username: data[BTRKORONE.STORAGE_KEYS.CACHED_USERNAME] || null,
      avatarUrl: data[BTRKORONE.STORAGE_KEYS.CACHED_AVATAR_URL] || null,
      tier,
      tierInfo,
      settings,
      toggles,
      lastVerified: data[BTRKORONE.STORAGE_KEYS.VERIFICATION_TIMESTAMP] || null,
      version: BTRKORONE.VERSION
    };
  }
};

if (typeof globalThis !== "undefined") {
  globalThis.BtrStorage = BtrStorage;
}
