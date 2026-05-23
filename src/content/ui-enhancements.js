/**
 * BtrKorone - UI Enhancements
 * Modernizes and cleans up the Korone website layout
 */

(function BtrUIEnhancements() {
  "use strict";

  // Wait for main script to initialize
  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);

    const { hasFeature, settings, tier } = window.__btrkorone;
    if (!settings.uiEnhancements) return;

    init();
  }, 100);

  function init() {
    enhanceNavbar();
    enhanceFooter();
    enhanceCards();
    enhanceProfilePage();
    addPremiumBadges();

    // Observe DOM changes for dynamically loaded content
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          enhanceCards();
          addPremiumBadges();
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Enhance the main navigation bar
   */
  function enhanceNavbar() {
    const navbar = document.querySelector(".navbar, nav, #navigation");
    if (!navbar) return;

    navbar.classList.add("btrkorone-navbar");

    // Add BtrKorone indicator
    const indicator = document.createElement("div");
    indicator.className = "btrkorone-indicator";
    indicator.innerHTML = `<span class="btrkorone-dot"></span>`;
    indicator.title = "BtrKorone Active";
    navbar.appendChild(indicator);
  }

  /**
   * Clean up the footer
   */
  function enhanceFooter() {
    const footer = document.querySelector("footer, .footer, #footer");
    if (!footer) return;

    footer.classList.add("btrkorone-footer");
  }

  /**
   * Enhance item/game cards with better hover effects and info display
   */
  function enhanceCards() {
    const cards = document.querySelectorAll(
      ".item-card:not(.btrk-enhanced), .game-card:not(.btrk-enhanced), .catalog-item:not(.btrk-enhanced)"
    );

    cards.forEach((card) => {
      card.classList.add("btrk-enhanced");
      card.classList.add("btrkorone-card");
    });
  }

  /**
   * Enhance user profile pages
   */
  function enhanceProfilePage() {
    if (!window.location.pathname.match(/\/users?\/\d+/i) && 
        !window.location.pathname.includes("/profile")) return;

    const { hasFeature, tier } = window.__btrkorone;
    if (!hasFeature("profileEnhancements")) return;

    const profileHeader = document.querySelector(
      ".profile-header, .user-header, #profile-header"
    );
    if (!profileHeader) return;

    profileHeader.classList.add("btrkorone-profile-header");

    // Add join date formatting enhancement
    const joinDate = profileHeader.querySelector(".join-date, .created-date");
    if (joinDate) {
      const dateText = joinDate.textContent;
      const parsed = new Date(dateText);
      if (!isNaN(parsed)) {
        joinDate.title = parsed.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        });
      }
    }
  }

  /**
   * Add premium tier badges next to usernames (if they have BtrKorone premium)
   */
  function addPremiumBadges() {
    const { settings, tier } = window.__btrkorone;
    if (!settings.showPremiumBadge || tier === 0) return;

    // Add badge to own username displays
    const usernameElements = document.querySelectorAll(
      ".current-user-name:not(.btrk-badged), .header-username:not(.btrk-badged)"
    );

    const tierInfo = tier === 2 ? BTRKORONE.TIERS.PRO : BTRKORONE.TIERS.PLUS;

    usernameElements.forEach((el) => {
      el.classList.add("btrk-badged");
      const badge = document.createElement("span");
      badge.className = "btrkorone-premium-badge";
      badge.textContent = tierInfo.badge;
      badge.style.color = tierInfo.color;
      badge.title = tierInfo.label;
      el.appendChild(badge);
    });
  }
})();
