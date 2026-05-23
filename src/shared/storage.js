/**
 * BtrKorone - Storage Utilities
 * Wrapper around chrome.storage.local for consistent data management
 */

const BtrStorage = {
  /**
   * Get a value from storage
   */
  async get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] ?? null);
      });
    });
  },

  /**
   * Get multiple values from storage
   */
  async getMultiple(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        resolve(result);
      });
    });
  },

  /**
   * Set a value in storage
   */
  async set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  },

  /**
   * Set multiple values in storage
   */
  async setMultiple(obj) {
    return new Promise((resolve) => {
      chrome.storage.local.set(obj, resolve);
    });
  },

  /**
   * Remove a key from storage
   */
  async remove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, resolve);
    });
  },

  /**
   * Clear all extension storage
   */
  async clear() {
    return new Promise((resolve) => {
      chrome.storage.local.clear(resolve);
    });
  },

  // --- Convenience methods ---

  async getUserId() {
    return this.get(BTRKORONE.STORAGE_KEYS.USER_ID);
  },

  async setUserId(userId) {
    return this.set(BTRKORONE.STORAGE_KEYS.USER_ID, userId);
  },

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

  async getSettings() {
    const settings = await this.get(BTRKORONE.STORAGE_KEYS.SETTINGS);
    return { ...BTRKORONE.DEFAULT_SETTINGS, ...(settings || {}) };
  },

  async updateSettings(newSettings) {
    const current = await this.getSettings();
    const merged = { ...current, ...newSettings };
    return this.set(BTRKORONE.STORAGE_KEYS.SETTINGS, merged);
  },

  async getVerificationTimestamp() {
    return this.get(BTRKORONE.STORAGE_KEYS.VERIFICATION_TIMESTAMP);
  },

  async setVerificationTimestamp(ts) {
    return this.set(BTRKORONE.STORAGE_KEYS.VERIFICATION_TIMESTAMP, ts);
  },

  async getCachedUsername() {
    return this.get(BTRKORONE.STORAGE_KEYS.CACHED_USERNAME);
  },

  async setCachedUsername(username) {
    return this.set(BTRKORONE.STORAGE_KEYS.CACHED_USERNAME, username);
  }
};

if (typeof globalThis !== "undefined") {
  globalThis.BtrStorage = BtrStorage;
}
