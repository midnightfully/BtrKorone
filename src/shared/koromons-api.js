/**
 * BtrKorone - Koromons API Client
 * Fetches live item values, demand, trend, supply, images, and ownership data
 * from the public Koromons API (https://www.koromons.com/api/items)
 *
 * Data structure from API:
 * {
 *   Name, Acronym, itemId, Image,
 *   Value, RAP, Demand, Trend,
 *   Available, Unavailable, Hoarded
 * }
 *
 * No authentication required for read endpoints.
 */

const KoromonsAPI = {
  BASE_URL: "https://www.koromons.com/api/items",
  CACHE_KEY: "btrkorone_koromons_cache",
  CACHE_TS_KEY: "btrkorone_koromons_cache_ts",
  CACHE_DURATION_MS: 30 * 60 * 1000, // 30 minutes (matches Discord bot)

  // In-memory cache for content scripts (populated from storage or fresh fetch)
  _items: [],
  _itemMap: {},       // name (lowercase) → item
  _acronymMap: {},    // acronym (lowercase) → item
  _idMap: {},         // itemId → item
  _loaded: false,

  // ============================================================
  // INITIALIZATION & CACHING
  // ============================================================

  /**
   * Load items - tries storage cache first, fetches fresh if stale
   * Returns true if items are available, false on total failure
   */
  async load() {
    if (this._loaded && this._items.length > 0) return true;

    // Try loading from chrome.storage cache
    const cached = await this._getFromStorage();
    if (cached && cached.items && cached.items.length > 0) {
      const age = Date.now() - (cached.ts || 0);
      if (age < this.CACHE_DURATION_MS) {
        this._buildMaps(cached.items);
        console.log(`[BtrKorone/Koromons] Loaded ${this._items.length} items from cache (${Math.round(age/60000)}m old)`);
        return true;
      }
    }

    // Cache is stale or missing - fetch fresh
    return await this.refresh();
  },

  /**
   * Force refresh from Koromons API
   */
  async refresh() {
    try {
      const response = await fetch(this.BASE_URL, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "BtrKorone Extension/2.0"
        }
      });

      if (!response.ok) {
        console.warn(`[BtrKorone/Koromons] API returned ${response.status}`);
        return this._items.length > 0; // Return true if we still have stale data
      }

      const items = await response.json();
      if (!Array.isArray(items) || items.length === 0) {
        console.warn("[BtrKorone/Koromons] API returned empty/invalid data");
        return this._items.length > 0;
      }

      this._buildMaps(items);
      await this._saveToStorage(items);
      console.log(`[BtrKorone/Koromons] Refreshed: ${items.length} items from API`);
      return true;
    } catch (error) {
      console.error("[BtrKorone/Koromons] Fetch failed:", error);
      return this._items.length > 0;
    }
  },

  /**
   * Build lookup maps from items array
   */
  _buildMaps(items) {
    this._items = items;
    this._itemMap = {};
    this._acronymMap = {};
    this._idMap = {};

    for (const item of items) {
      const name = (item.Name || item.name || "").toLowerCase().trim();
      const acronym = (item.Acronym || item.acronym || "").toLowerCase().trim();
      const id = item.itemId || item.id;

      if (name) this._itemMap[name] = item;
      if (acronym) this._acronymMap[acronym] = item;
      if (id) this._idMap[String(id)] = item;
    }

    this._loaded = true;
  },

  // ============================================================
  // STORAGE HELPERS
  // ============================================================

  async _getFromStorage() {
    if (typeof chrome === "undefined" || !chrome.storage) return null;
    return new Promise((resolve) => {
      chrome.storage.local.get([this.CACHE_KEY, this.CACHE_TS_KEY], (result) => {
        resolve({
          items: result[this.CACHE_KEY] || null,
          ts: result[this.CACHE_TS_KEY] || 0
        });
      });
    });
  },

  async _saveToStorage(items) {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    return new Promise((resolve) => {
      chrome.storage.local.set({
        [this.CACHE_KEY]: items,
        [this.CACHE_TS_KEY]: Date.now()
      }, resolve);
    });
  },

  // ============================================================
  // ITEM LOOKUP
  // ============================================================

  /**
   * Get item by exact name (case-insensitive)
   */
  getByName(name) {
    if (!name) return null;
    const key = name.toLowerCase().trim();
    return this._itemMap[key] || this._acronymMap[key] || null;
  },

  /**
   * Get item by ID
   */
  getById(itemId) {
    return this._idMap[String(itemId)] || null;
  },

  /**
   * Fuzzy search - matches against Name and Acronym
   * Uses same logic as the Discord bot (SequenceMatcher equivalent)
   * Returns best match or null if ratio < 0.6
   */
  fuzzySearch(query) {
    if (!query || this._items.length === 0) return null;

    const input = query.toLowerCase().trim();
    let bestMatch = null;
    let highestRatio = 0;

    for (const item of this._items) {
      const name = (item.Name || "").toLowerCase();
      const acronym = (item.Acronym || "").toLowerCase();

      // Exact match short-circuit
      if (input === name || (acronym && input === acronym)) {
        return item;
      }

      // Fuzzy ratio (simplified Levenshtein-based similarity)
      const nameRatio = this._similarity(input, name);
      const acronymRatio = acronym ? this._similarity(input, acronym) : 0;
      const maxRatio = Math.max(nameRatio, acronymRatio);

      if (maxRatio > highestRatio) {
        highestRatio = maxRatio;
        bestMatch = item;
      }
    }

    return highestRatio > 0.6 ? bestMatch : null;
  },

  /**
   * Search with multiple results (for autocomplete/suggestions)
   * Returns up to `limit` items sorted by relevance
   */
  search(query, limit = 5) {
    if (!query || this._items.length === 0) return [];

    const input = query.toLowerCase().trim();
    const results = [];

    for (const item of this._items) {
      const name = (item.Name || "").toLowerCase();
      const acronym = (item.Acronym || "").toLowerCase();

      // Substring match bonus
      const containsName = name.includes(input) || input.includes(name);
      const containsAcronym = acronym && (acronym.includes(input) || input.includes(acronym));

      const nameRatio = this._similarity(input, name);
      const acronymRatio = acronym ? this._similarity(input, acronym) : 0;
      let score = Math.max(nameRatio, acronymRatio);

      // Boost substring matches
      if (containsName || containsAcronym) score = Math.max(score, 0.7);

      if (score > 0.4) {
        results.push({ item, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => r.item);
  },

  // ============================================================
  // VALUE HELPERS
  // ============================================================

  /**
   * Get item value (returns 0 if not found)
   */
  getValue(nameOrItem) {
    const item = typeof nameOrItem === "string" ? this.getByName(nameOrItem) : nameOrItem;
    if (!item) return 0;
    return parseInt(item.Value || item.value || 0) || 0;
  },

  /**
   * Get item RAP
   */
  getRAP(nameOrItem) {
    const item = typeof nameOrItem === "string" ? this.getByName(nameOrItem) : nameOrItem;
    if (!item) return 0;
    return parseInt(item.RAP || item.rap || 0) || 0;
  },

  /**
   * Get demand string
   */
  getDemand(nameOrItem) {
    const item = typeof nameOrItem === "string" ? this.getByName(nameOrItem) : nameOrItem;
    if (!item) return "Unknown";
    return item.Demand || item.demand || "Unknown";
  },

  /**
   * Get trend string
   */
  getTrend(nameOrItem) {
    const item = typeof nameOrItem === "string" ? this.getByName(nameOrItem) : nameOrItem;
    if (!item) return "Unknown";
    return item.Trend || item.trend || "Unknown";
  },

  /**
   * Get supply data
   */
  getSupply(nameOrItem) {
    const item = typeof nameOrItem === "string" ? this.getByName(nameOrItem) : nameOrItem;
    if (!item) return { available: 0, unavailable: 0, hoarded: 0 };
    return {
      available: parseInt(item.Available || item["Available Copies"] || 0) || 0,
      unavailable: parseInt(item.Unavailable || item["Unavailable Copies"] || 0) || 0,
      hoarded: parseInt(item.Hoarded || item["Hoarded Copies"] || 0) || 0
    };
  },

  /**
   * Get image URL for item
   */
  getImage(nameOrItem) {
    const item = typeof nameOrItem === "string" ? this.getByName(nameOrItem) : nameOrItem;
    if (!item) return null;
    return item.Image || item.image || null;
  },

  /**
   * Get full item data formatted for display
   */
  getItemData(nameOrItem) {
    const item = typeof nameOrItem === "string"
      ? (this.getByName(nameOrItem) || this.fuzzySearch(nameOrItem))
      : nameOrItem;

    if (!item) return null;

    return {
      name: item.Name || item.name || "Unknown",
      acronym: item.Acronym || item.acronym || "",
      itemId: item.itemId || item.id || null,
      image: item.Image || item.image || null,
      value: parseInt(item.Value || item.value || 0) || 0,
      rap: parseInt(item.RAP || item.rap || 0) || 0,
      demand: item.Demand || item.demand || "Unknown",
      trend: item.Trend || item.trend || "Unknown",
      supply: this.getSupply(item)
    };
  },

  // ============================================================
  // OWNERSHIP LOOKUP (Rex tier)
  // ============================================================

  /**
   * Fetch ownership records for an item by its itemId
   * Returns array of { name, serial } objects
   */
  async getOwners(itemId) {
    if (!itemId) return [];

    try {
      const response = await fetch(`${this.BASE_URL}/${itemId}/owners`, {
        headers: { "Accept": "application/json" }
      });

      if (!response.ok) return [];

      const raw = await response.json();
      let owners = [];

      // Handle different response shapes (same logic as Discord bot)
      if (Array.isArray(raw)) {
        owners = raw;
      } else if (raw && typeof raw === "object") {
        for (const key of ["owners", "records", "data", "copied", "ownersList"]) {
          if (raw[key] && Array.isArray(raw[key])) {
            owners = raw[key];
            break;
          }
        }
      }

      // Normalize entries
      return owners.map(entry => {
        if (typeof entry === "string") {
          try {
            entry = JSON.parse(entry.replace(/'/g, '"'));
          } catch (e) {
            return { name: entry, serial: "N/A" };
          }
        }
        if (typeof entry === "object" && entry !== null) {
          return {
            name: entry.name || entry.username || entry.owner || "Unknown",
            serial: entry.serial || entry.Serial || "N/A"
          };
        }
        return null;
      }).filter(e => e && e.name && e.name.toLowerCase() !== "none");
    } catch (error) {
      console.error("[BtrKorone/Koromons] Owners fetch failed:", error);
      return [];
    }
  },

  // ============================================================
  // UTILITY
  // ============================================================

  /**
   * Simple string similarity (0-1) - equivalent to Python's SequenceMatcher.ratio()
   */
  _similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const longer = a.length >= b.length ? a : b;
    const shorter = a.length < b.length ? a : b;

    if (longer.length === 0) return 1;

    // LCS-based similarity
    const lcsLen = this._lcsLength(shorter, longer);
    return (2 * lcsLen) / (a.length + b.length);
  },

  /**
   * Longest Common Subsequence length
   */
  _lcsLength(a, b) {
    const m = a.length;
    const n = b.length;
    // Optimized: only keep 2 rows
    let prev = new Array(n + 1).fill(0);
    let curr = new Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          curr[j] = prev[j - 1] + 1;
        } else {
          curr[j] = Math.max(prev[j], curr[j - 1]);
        }
      }
      [prev, curr] = [curr, prev];
      curr.fill(0);
    }
    return prev[n];
  },

  /**
   * Get total number of cached items
   */
  get itemCount() {
    return this._items.length;
  },

  /**
   * Check if cache is loaded
   */
  get isLoaded() {
    return this._loaded && this._items.length > 0;
  },

  /**
   * Get demand color for UI rendering
   */
  getDemandColor(demand) {
    const colors = {
      "Very High": "#ff4444",
      "High": "#ff8c00",
      "Medium": "#ffd700",
      "Low": "#87ceeb",
      "Very Low": "#808080",
      "Unknown": "#555555"
    };
    return colors[demand] || colors["Unknown"];
  },

  /**
   * Get trend icon for UI
   */
  getTrendIcon(trend) {
    const icons = {
      "Rising": "📈",
      "Stable": "➡️",
      "Falling": "📉",
      "Unstable": "↕️",
      "Unknown": "❓"
    };
    return icons[trend] || icons["Unknown"];
  }
};

// Export globally
if (typeof globalThis !== "undefined") {
  globalThis.KoromonsAPI = KoromonsAPI;
}
