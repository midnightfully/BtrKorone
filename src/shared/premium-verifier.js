/**
 * BtrKorone - Premium Verification System
 * Uses Pekora API for username/avatar, Roblox API for gamepass verification
 *
 * Flow:
 * 1. User provides Korone User ID (from pekora.zip/users/{id}/profile)
 * 2. Extension generates unique token, user puts it in Korone About Me
 * 3. Extension checks Korone About Me for token (via Pekora API)
 * 4. Extension checks Roblox gamepass ownership (Plus / Rex)
 * 5. Tier activated, username + avatar cached from Pekora
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

  // === Pekora Avatar (Public - no auth needed) ===

  /**
   * Get Pekora avatar URL for a user (direct image URL, no fetch needed)
   */
  getAvatarUrl(userId) {
    return BTRKORONE.PEKORA_API.USER_HEADSHOT.replace("{userId}", userId);
  },

  // === Pekora Profile (needs user to be logged in on pekora.zip) ===

  /**
   * Fetch user profile from Pekora API
   * Note: requires the user's .PUPPYSECURITY cookie (auto-sent by browser)
   */
  async fetchPekoraProfile(userId) {
    const url = BTRKORONE.PEKORA_API.USER_PROFILE.replace("{userId}", userId);
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error("[BtrKorone] Pekora profile fetch error:", error);
      return null;
    }
  },

  /**
   * Fetch Korone About Me / description for token verification
   */
  async fetchKoroneAboutMe(userId) {
    const profile = await this.fetchPekoraProfile(userId);
    if (!profile) return "";
    return profile.description || profile.blurb || profile.aboutMe || profile.bio || "";
  },

  /**
   * Verify the token exists in user's Korone About Me section
   */
  async verifyKoroneToken(userId, expectedToken) {
    const aboutMe = await this.fetchKoroneAboutMe(userId);
    if (aboutMe === "") {
      // Could be empty profile or failed fetch
      return { verified: false, error: "PROFILE_FETCH_FAILED" };
    }
    const hasToken = aboutMe.includes(expectedToken);
    return { verified: hasToken, error: hasToken ? null : "TOKEN_NOT_FOUND" };
  },

  // === Pekora Gamepass Ownership ===

  async checkGamepassOwnership(userId, gamepassId) {
    const url = BTRKORONE.GAMEPASS_API.INVENTORY
      .replace("{userId}", userId)
      .replace("{gamepassId}", gamepassId);
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) {
        if (response.status === 403) return { owned: false, error: "PRIVATE_INVENTORY" };
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

  // === Full Verification ===

  async performFullVerification(userId, token) {
    // Step 1: Verify token in Korone About Me
    const tokenResult = await this.verifyKoroneToken(userId, token);
    if (!tokenResult.verified) {
      return {
        success: false,
        tier: BTRKORONE.TIERS.FREE.id,
        error: tokenResult.error,
        message: tokenResult.error === "PROFILE_FETCH_FAILED"
          ? "Could not fetch your Korone profile. Make sure you're logged in to pekora.zip."
          : "Verification token not found in your Korone About Me section. Make sure you saved it."
      };
    }

    // Step 2: Get username from Pekora
    const profile = await this.fetchPekoraProfile(userId);
    const username = profile ? (profile.name || profile.username || profile.displayName) : null;

    // Step 3: Avatar URL (public, no fetch needed)
    const avatarUrl = this.getAvatarUrl(userId);

    // Step 4: Check Rex gamepass first (higher tier)
    const rexCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.REX.gamepassId);
    if (rexCheck.owned) {
      return { success: true, tier: BTRKORONE.TIERS.REX.id, username, avatarUrl, error: null,
        message: "BtrKorone Rex activated! You have access to ALL premium features." };
    }

    // Step 5: Check Plus gamepass
    const plusCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.PLUS.gamepassId);
    if (plusCheck.owned) {
      return { success: true, tier: BTRKORONE.TIERS.PLUS.id, username, avatarUrl, error: null,
        message: "BtrKorone+ activated! Enjoy your enhanced features." };
    }

    // Step 6: Token verified but no gamepass
    const isPrivate = rexCheck.error === "PRIVATE_INVENTORY" || plusCheck.error === "PRIVATE_INVENTORY";
    return {
      success: false, tier: BTRKORONE.TIERS.FREE.id, username, avatarUrl, error: "NO_GAMEPASS",
      message: isPrivate
        ? "Your Korone inventory is private. Make it public to verify gamepass ownership."
        : "Token verified, but no BtrKorone gamepass found. Purchase a gamepass to unlock premium."
    };
  },

  // === Account Link Only (no gamepass check) ===
  // Used by the "Link Account" button. Confirms the user owns the Korone
  // account by checking their About Me for the verification token, then
  // caches their username + avatar. Premium tier is NOT touched here -
  // a separate "Verify Subscription" button will handle that later.

  async performAccountLink(userId, token) {
    const tokenResult = await this.verifyKoroneToken(userId, token);
    if (!tokenResult.verified) {
      return {
        success: false,
        error: tokenResult.error,
        message: tokenResult.error === "PROFILE_FETCH_FAILED"
          ? "Could not fetch your Korone profile. Make sure you're logged in to pekora.zip."
          : "Verification token not found in your Korone About Me section. Make sure you saved it."
      };
    }

    const profile = await this.fetchPekoraProfile(userId);
    const username = profile ? (profile.name || profile.username || profile.displayName) : null;
    const avatarUrl = this.getAvatarUrl(userId);

    return {
      success: true,
      username,
      avatarUrl,
      error: null,
      message: "Account linked successfully!"
    };
  },

  // === Background Recheck ===

  async recheckOwnership(userId) {
    const rexCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.REX.gamepassId);
    if (rexCheck.owned) return BTRKORONE.TIERS.REX.id;
    const plusCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.PLUS.gamepassId);
    if (plusCheck.owned) return BTRKORONE.TIERS.PLUS.id;
    return BTRKORONE.TIERS.FREE.id;
  }
};

if (typeof globalThis !== "undefined") {
  globalThis.PremiumVerifier = PremiumVerifier;
}
