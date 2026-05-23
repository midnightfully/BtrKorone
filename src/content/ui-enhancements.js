/**
 * BtrKorone - UI Enhancements
 * Card hover effects, premium badges
 * Play button logic is handled in main.js for immediate injection
 */

(function BtrUIEnhancements() {
  "use strict";

  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);

    init();
  }, 50);

  function init() {
    enhanceCards();
    addPremiumBadges();

    // Observe DOM for dynamically loaded content
    const observer = new MutationObserver((mutations) => {
      let hasNew = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) { hasNew = true; break; }
      }
      if (hasNew) {
        enhanceCards();
        addPremiumBadges();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Enhance the main navigation bar with BtrKorone indicator
   */
  function enhanceNavbar() {
    const navbar = document.querySelector(".navbar, nav, #navigation, .nav-container");
    if (!navbar || navbar.querySelector(".btrkorone-indicator")) return;

    navbar.classList.add("btrkorone-navbar");

    const indicator = document.createElement("div");
    indicator.className = "btrkorone-indicator";
    indicator.innerHTML = '<span class="btrkorone-dot"></span>';
    indicator.title = "BtrKorone Active";
    document.body.appendChild(indicator);
  }

  /**
   * Enhance item/game cards with hover effects
   */
  function enhanceCards() {
    const cards = document.querySelectorAll(
      ".item-card:not(.btrk-enhanced), " +
      ".game-card:not(.btrk-enhanced), " +
      ".catalog-item:not(.btrk-enhanced), " +
      ".game-item:not(.btrk-enhanced), " +
      ".asset-card:not(.btrk-enhanced)"
    );

    cards.forEach((card) => {
      card.classList.add("btrk-enhanced", "btrkorone-card");
    });
  }

  /**
   * Profile page enhancements (Plus+ feature)
   */
  function enhanceProfilePage() {
    const { hasFeature } = window.__btrkorone;
    if (!hasFeature("profileEnhancements")) return;

    const isProfilePage = window.location.pathname.match(/\/users?\/\d+/i) ||
                          window.location.pathname.includes("/profile");
    if (!isProfilePage) return;

    const profileHeader = document.querySelector(
      ".profile-header, .user-header, #profile-header, .profile-container"
    );
    if (!profileHeader || profileHeader.classList.contains("btrk-profile-enhanced")) return;

    profileHeader.classList.add("btrk-profile-enhanced", "btrkorone-profile-header");

    // Enhance join date display
    const joinDate = profileHeader.querySelector(".join-date, .created-date, .member-since");
    if (joinDate) {
      const dateText = joinDate.textContent.trim();
      const parsed = new Date(dateText);
      if (!isNaN(parsed)) {
        joinDate.title = parsed.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        });
        joinDate.classList.add("btrkorone-date-enhanced");
      }
    }

    // Add account age display
    const createdEl = profileHeader.querySelector("[data-created], .created-date");
    if (createdEl) {
      const created = new Date(createdEl.dataset.created || createdEl.textContent);
      if (!isNaN(created)) {
        const days = Math.floor((Date.now() - created) / 86400000);
        const ageTag = document.createElement("span");
        ageTag.className = "btrkorone-account-age";
        if (days < 365) {
          ageTag.textContent = `${days}d old`;
        } else {
          ageTag.textContent = `${Math.floor(days / 365)}y ${days % 365}d old`;
        }
        createdEl.parentNode.insertBefore(ageTag, createdEl.nextSibling);
      }
    }
  }

  /**
   * Add premium tier badges next to own username
   */
  function addPremiumBadges() {
    const { hasFeature, tier } = window.__btrkorone;
    if (!hasFeature("showPremiumBadge") || tier === 0) return;

    const usernameElements = document.querySelectorAll(
      ".current-user-name:not(.btrk-badged), " +
      ".header-username:not(.btrk-badged), " +
      ".authenticated-user-name:not(.btrk-badged), " +
      ".navbar-username:not(.btrk-badged)"
    );

    const tierInfo = tier === 2 ? BTRKORONE.TIERS.REX : BTRKORONE.TIERS.PLUS;

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
