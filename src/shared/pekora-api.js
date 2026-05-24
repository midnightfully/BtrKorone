/**
 * BtrKorone - Pekora API Client
 * Wraps trade, inventory, and user endpoints used across content scripts.
 *
 * All requests use credentials:"include" so the user's .PUPPYSECURITY cookie
 * is automatically attached.
 */

const PekoraAPI = {
  BASE: "https://www.pekora.zip/apisite",

  // === Trades ===

  async getInboundTrades(cursor = "") {
    return this._fetchJSON(`${this.BASE}/trades/v1/trades/inbound?cursor=${cursor}`);
  },

  async getOutboundTrades(cursor = "") {
    return this._fetchJSON(`${this.BASE}/trades/v1/trades/outbound?cursor=${cursor}`);
  },

  async getCompletedTrades(cursor = "") {
    return this._fetchJSON(`${this.BASE}/trades/v1/trades/completed?cursor=${cursor}`);
  },

  async getTradeDetail(tradeId) {
    if (!tradeId) return null;
    return this._fetchJSON(`${this.BASE}/trades/v1/trades/${tradeId}`);
  },

  // === Inventory / User ===

  async getCollectibles(userId) {
    return this._fetchJSON(`${this.BASE}/inventory/v2/users/${userId}/assets/collectibles?limit=100&sortOrder=Desc`);
  },

  async checkAssetOwnership(userId, assetId) {
    return this._fetchJSON(`${this.BASE}/inventory/v1/users/${userId}/items/Asset/${assetId}`);
  },

  async getUserProfile(userId) {
    return this._fetchJSON(`${this.BASE}/users/v1/users/${userId}`);
  },

  async getAuthenticatedUser() {
    return this._fetchJSON(`${this.BASE}/users/v1/users/authenticated`);
  },

  getAvatarUrl(userId) {
    return `https://www.pekora.zip/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`;
  },

  // === Internal helper ===

  async _fetchJSON(url) {
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) {
        if (response.status !== 404) {
          console.warn(`[PekoraAPI] ${url} returned ${response.status}`);
        }
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error(`[PekoraAPI] Fetch error for ${url}:`, error);
      return null;
    }
  },

  // === Trade Analysis Helpers ===

  /**
   * Split a trade's offers into "your" and "their" sides
   */
  splitTradeOffers(tradeDetail, myUserId) {
    if (!tradeDetail || !tradeDetail.offers) {
      return { myOffer: null, theirOffer: null, partner: null };
    }
    const me = Number(myUserId);
    const myOffer = tradeDetail.offers.find(o => o.user && o.user.id === me);
    const theirOffer = tradeDetail.offers.find(o => o.user && o.user.id !== me);
    const partner = theirOffer ? theirOffer.user : null;
    return { myOffer, theirOffer, partner };
  },

  /**
   * Calculate total Koromons value for a list of trade items.
   * Falls back to RAP if no Koromons value is known.
   */
  calculateOfferValue(userAssets) {
    if (!userAssets || userAssets.length === 0) {
      return { totalValue: 0, totalRap: 0, valuedItems: 0, items: [] };
    }

    const items = userAssets.map(a => {
      const itemName = a.name || "";
      const rap = a.recentAveragePrice || 0;
      let koromonValue = 0;
      let demand = "Unknown";
      let hasKoromonValue = false;

      if (typeof KoromonsAPI !== "undefined" && KoromonsAPI.isLoaded) {
        const data = KoromonsAPI.getItemData(itemName);
        if (data && data.value > 0) {
          koromonValue = data.value;
          demand = data.demand;
          hasKoromonValue = true;
        }
      }

      return {
        name: itemName,
        userAssetId: a.id,
        assetId: a.assetId,
        rap,
        koromonValue,
        demand,
        hasKoromonValue,
        score: hasKoromonValue ? koromonValue : rap
      };
    });

    const totalValue = items.reduce((s, i) => s + i.score, 0);
    const totalRap = items.reduce((s, i) => s + i.rap, 0);
    const valuedItems = items.filter(i => i.hasKoromonValue).length;

    return { totalValue, totalRap, valuedItems, items };
  }
};

if (typeof globalThis !== "undefined") {
  globalThis.PekoraAPI = PekoraAPI;
}
