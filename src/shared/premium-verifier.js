/**
 * BtrKorone - Premium Verification System
 * Handles Roblox gamepass ownership verification and Korone About Me token validation
 * Also fetches and caches user avatar
 *
 * Verification Flow:
 * 1. User provides their Roblox User ID
 * 2. Extension generates a unique random verification token
 * 3. User places token in their Korone "About Me" section
 * 4. User clicks "Verify" - extension checks Korone About Me for token
 * 5. Extension also checks Roblox gamepass ownership (Plus / Rex)
 * 6. Premium tier is activated and cached locally
 * 7. Avatar is fetched from Roblox thumbnail API and cached
 */

const PremiumVerifier = {
  /**
   * Generate a cryptographically unique verification token
   */
  generateToken(userId) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let random = "";
    const array = new Uint8Array(12);
    crypto.getRandomValues(array);
    for (let i = 0; i < array.length; i++) {
      random += chars[array[i] % chars.length];
    }
    return `${BTRKORONE.VERIFICATION.TOKEN_PREFIX}${userId}-${random}`;
  },

  // === Avatar Fetching ===

  /**
   * Fetch user's Roblox avatar headshot URL
   */
  async fetchAvatarUrl(userId) {
    const url = BTRKORONE.ROBLOX_API.USER_AVATAR_HEADSHOT.replace("{userId}", userId);
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      if (data.data && data.data.length > 0 && data.data[0].imageUrl) {
        return data.data[0].imageUrl;
      }
      return null;
    } catch (error) {
      console.error("[BtrKorone] Avatar fetch error:", error);
      return null;
    }
  },

  // === Roblox Profile ===

  /**
   * Fetch user profile from Roblox API
   */
  async fetchRobloxProfile(userId) {
    const url = BTRKORONE.ROBLOX_API.USER_PROFILE.replace("{userId}", userId);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Profile fetch failed: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("[BtrKorone] Roblox profile fetch error:", error);
      return null;
    }
  },

  // === Korone About Me Verification ===

  /**
   * Fetch user's Korone About Me / description to look for verification token
   * This checks the Korone platform profile, not Roblox
   */
  async fetchKoroneAboutMe(userId) {
    // Try Korone API endpoint for user about/description
    const url = BTRKORONE.KORONE_API_ENDPOINTS.USER_ABOUT.replace("{userId}", userId);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        // Fallback: try the general user profile endpoint
        return await this.fetchKoroneProfileDescription(userId);
      }
      const data = await response.json();
      // Return the about/description text
      return data.description || data.aboutMe || data.blurb || "";
    } catch (error) {
      console.warn("[BtrKorone] Korone About Me fetch error, trying fallback:", error);
      return await this.fetchKoroneProfileDescription(userId);
    }
  },

  /**
   * Fallback: fetch Korone user profile and extract description
   */
  async fetchKoroneProfileDescription(userId) {
    const url = BTRKORONE.KORONE_API_ENDPOINTS.USER_PROFILE.replace("{userId}", userId);
    try {
      const response = await fetch(url);
      if (!response.ok) return "";
      const data = await response.json();
      return data.description || data.aboutMe || data.blurb || data.bio || "";
    } catch (error) {
      console.error("[BtrKorone] Korone profile fetch error:", error);
      return "";
    }
  },

  /**
   * Verify the token exists in user's Korone About Me section
   */
  async verifyKoroneToken(userId, expectedToken) {
    const aboutMe = await this.fetchKoroneAboutMe(userId);
    if (aboutMe === null || aboutMe === undefined) {
      return { verified: false, error: "PROFILE_FETCH_FAILED" };
    }

    const hasToken = aboutMe.includes(expectedToken);
    return {
      verified: hasToken,
      error: hasToken ? null : "TOKEN_NOT_FOUND"
    };
  },

  // === Gamepass Ownership ===

  /**
   * Check if user owns a specific Roblox gamepass
   */
  async checkGamepassOwnership(userId, gamepassId) {
    const url = BTRKORONE.ROBLOX_API.INVENTORY
      .replace("{userId}", userId)
      .replace("{gamepassId}", gamepassId);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 403) {
          return { owned: false, error: "PRIVATE_INVENTORY" };
        }
        throw new Error(`Inventory check failed: ${response.status}`);
      }
      const data = await response.json();
      const owned = data.data && data.data.length > 0;
      return { owned, error: null };
    } catch (error) {
      console.error("[BtrKorone] Gamepass check error:", error);
      return { owned: false, error: error.message };
    }
  },

  // === Full Verification Flow ===

  /**
   * Full verification: check Korone About Me for token + check gamepass ownership
   * Returns the highest tier the user qualifies for
   */
  async performFullVerification(userId, token) {
    // Step 1: Verify token in Korone About Me
    const tokenResult = await this.verifyKoroneToken(userId, token);
    if (!tokenResult.verified) {
      return {
        success: false,
        tier: BTRKORONE.TIERS.FREE.id,
        error: tokenResult.error,
        message: tokenResult.error === "PROFILE_FETCH_FAILED"
          ? "Could not fetch your Korone profile. Please try again."
          : "Verification token not found in your Korone About Me section. Make sure you saved it."
      };
    }

    // Step 2: Fetch Roblox profile for username
    const robloxProfile = await this.fetchRobloxProfile(userId);
    const username = robloxProfile ? robloxProfile.name : null;

    // Step 3: Fetch and cache avatar
    const avatarUrl = await this.fetchAvatarUrl(userId);

    // Step 4: Check Rex gamepass first (higher tier)
    const rexCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.REX.gamepassId);
    if (rexCheck.owned) {
      return {
        success: true,
        tier: BTRKORONE.TIERS.REX.id,
        username,
        avatarUrl,
        error: null,
        message: "BtrKorone Rex activated! You have access to ALL premium features."
      };
    }

    // Step 5: Check Plus gamepass
    const plusCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.PLUS.gamepassId);
    if (plusCheck.owned) {
      return {
        success: true,
        tier: BTRKORONE.TIERS.PLUS.id,
        username,
        avatarUrl,
        error: null,
        message: "BtrKorone+ activated! Enjoy your enhanced features."
      };
    }

    // Step 6: Token verified but no gamepass owned
    const isPrivate = rexCheck.error === "PRIVATE_INVENTORY" || plusCheck.error === "PRIVATE_INVENTORY";
    const errorMsg = isPrivate
      ? "Your Roblox inventory is private. Please make it public to verify gamepass ownership, then try again."
      : "Token verified, but no BtrKorone gamepass found. Purchase a gamepass via Robux to unlock premium features.";

    return {
      success: false,
      tier: BTRKORONE.TIERS.FREE.id,
      username,
      avatarUrl,
      error: "NO_GAMEPASS",
      message: errorMsg
    };
  },

  // === Background Recheck ===

  /**
   * Quick re-verification (skips token check, just checks gamepass ownership)
   * Used for periodic background rechecks
   */
  async recheckOwnership(userId) {
    const rexCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.REX.gamepassId);
    if (rexCheck.owned) return BTRKORONE.TIERS.REX.id;

    const plusCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.PLUS.gamepassId);
    if (plusCheck.owned) return BTRKORONE.TIERS.PLUS.id;

    return BTRKORONE.TIERS.FREE.id;
  },

  /**
   * Check if verification cache has expired
   */
  async needsRecheck() {
    const lastCheck = await BtrStorage.getVerificationTimestamp();
    if (!lastCheck) return true;
    const hoursSinceCheck = (Date.now() - lastCheck) / (1000 * 60 * 60);
    return hoursSinceCheck >= BTRKORONE.VERIFICATION.RECHECK_INTERVAL_HOURS;
  }
};

if (typeof globalThis !== "undefined") {
  globalThis.PremiumVerifier = PremiumVerifier;
}
