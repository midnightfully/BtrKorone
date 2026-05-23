/**
 * BtrKorone - Premium Verification System
 * Handles Roblox gamepass ownership verification and profile-based token validation
 * 
 * Flow:
 * 1. User provides their Roblox User ID
 * 2. Extension generates a unique verification token
 * 3. User places token in their Roblox profile description
 * 4. Extension verifies token in profile AND checks gamepass ownership
 * 5. Premium tier is activated and cached locally
 */

const PremiumVerifier = {
  /**
   * Generate a unique verification token for a user
   */
  generateToken(userId) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${BTRKORONE.VERIFICATION.TOKEN_PREFIX}${userId}-${timestamp}-${random}`;
  },

  /**
   * Fetch user profile from Roblox API to verify token placement
   */
  async fetchUserProfile(userId) {
    const url = BTRKORONE.ROBLOX_API.USER_PROFILE.replace("{userId}", userId);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch profile: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error("[BtrKorone] Profile fetch error:", error);
      return null;
    }
  },

  /**
   * Check if user owns a specific gamepass
   */
  async checkGamepassOwnership(userId, gamepassId) {
    const url = BTRKORONE.ROBLOX_API.INVENTORY
      .replace("{userId}", userId)
      .replace("{gamepassId}", gamepassId);
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        // 403 means inventory is private - we can't verify
        if (response.status === 403) {
          return { owned: false, error: "PRIVATE_INVENTORY" };
        }
        throw new Error(`Inventory check failed: ${response.status}`);
      }
      const data = await response.json();
      // If data array has items, user owns the gamepass
      const owned = data.data && data.data.length > 0;
      return { owned, error: null };
    } catch (error) {
      console.error("[BtrKorone] Gamepass check error:", error);
      return { owned: false, error: error.message };
    }
  },

  /**
   * Verify the token exists in user's Roblox profile description
   */
  async verifyProfileToken(userId, expectedToken) {
    const profile = await this.fetchUserProfile(userId);
    if (!profile) {
      return { verified: false, error: "PROFILE_FETCH_FAILED" };
    }

    const description = profile[BTRKORONE.VERIFICATION.PROFILE_TOKEN_FIELD] || "";
    const hasToken = description.includes(expectedToken);

    return {
      verified: hasToken,
      username: profile.name || null,
      error: hasToken ? null : "TOKEN_NOT_FOUND"
    };
  },

  /**
   * Full verification flow: verify token + check gamepass ownership
   * Returns the highest tier the user qualifies for
   */
  async performFullVerification(userId, token) {
    // Step 1: Verify profile token
    const tokenResult = await this.verifyProfileToken(userId, token);
    if (!tokenResult.verified) {
      return {
        success: false,
        tier: BTRKORONE.TIERS.FREE.id,
        error: tokenResult.error,
        message: "Verification token not found in your Roblox profile description."
      };
    }

    // Step 2: Check Pro gamepass first (higher tier)
    const proCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.PRO.gamepassId);
    if (proCheck.owned) {
      return {
        success: true,
        tier: BTRKORONE.TIERS.PRO.id,
        username: tokenResult.username,
        error: null,
        message: "BtrKorone Pro activated! You have access to all premium features."
      };
    }

    // Step 3: Check Plus gamepass
    const plusCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.PLUS.gamepassId);
    if (plusCheck.owned) {
      return {
        success: true,
        tier: BTRKORONE.TIERS.PLUS.id,
        username: tokenResult.username,
        error: null,
        message: "BtrKorone+ activated! Enjoy your enhanced features."
      };
    }

    // Step 4: Token verified but no gamepass owned
    const errorMsg = proCheck.error === "PRIVATE_INVENTORY" || plusCheck.error === "PRIVATE_INVENTORY"
      ? "Your Roblox inventory is private. Please make it public to verify gamepass ownership."
      : "Token verified, but no BtrKorone gamepass found. Purchase a gamepass to unlock premium features.";

    return {
      success: false,
      tier: BTRKORONE.TIERS.FREE.id,
      username: tokenResult.username,
      error: "NO_GAMEPASS",
      message: errorMsg
    };
  },

  /**
   * Quick re-verification (skips token check, just checks gamepass)
   * Used for periodic background rechecks
   */
  async recheckOwnership(userId) {
    const proCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.PRO.gamepassId);
    if (proCheck.owned) return BTRKORONE.TIERS.PRO.id;

    const plusCheck = await this.checkGamepassOwnership(userId, BTRKORONE.TIERS.PLUS.gamepassId);
    if (plusCheck.owned) return BTRKORONE.TIERS.PLUS.id;

    return BTRKORONE.TIERS.FREE.id;
  },

  /**
   * Check if verification needs to be rechecked
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
