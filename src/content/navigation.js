/**
 * BtrKorone - Quick Navigation
 * Adds useful shortcuts and navigation tweaks
 */

(function BtrNavigation() {
  "use strict";

  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);

    const { settings } = window.__btrkorone;
    if (!settings.quickNavigation) return;

    init();
  }, 100);

  function init() {
    addQuickNavBar();
    addKeyboardShortcuts();
    enhancePagination();
  }

  /**
   * Add a quick navigation bar with commonly used links
   */
  function addQuickNavBar() {
    const existingBar = document.querySelector(".btrkorone-quicknav");
    if (existingBar) return;

    const navLinks = [
      { label: "Home", href: "/", icon: "H" },
      { label: "Catalog", href: "/catalog", icon: "C" },
      { label: "Games", href: "/games", icon: "G" },
      { label: "Trades", href: "/trades", icon: "T" },
      { label: "Inventory", href: "/my/inventory", icon: "I" },
      { label: "Friends", href: "/my/friends", icon: "F" },
      { label: "Groups", href: "/groups", icon: "Gr" },
      { label: "Settings", href: "/my/settings", icon: "S" }
    ];

    const quickNav = document.createElement("div");
    quickNav.className = "btrkorone-quicknav";

    const inner = document.createElement("div");
    inner.className = "btrkorone-quicknav-inner";

    navLinks.forEach((link) => {
      const a = document.createElement("a");
      a.href = link.href;
      a.className = "btrkorone-quicknav-link";
      a.textContent = link.label;
      a.title = `Go to ${link.label} (Alt+${link.icon})`;

      // Highlight current page
      if (window.location.pathname === link.href || 
          window.location.pathname.startsWith(link.href + "/")) {
        a.classList.add("active");
      }

      inner.appendChild(a);
    });

    quickNav.appendChild(inner);

    // Insert after navbar
    const navbar = document.querySelector(".navbar, nav, #navigation");
    if (navbar && navbar.parentNode) {
      navbar.parentNode.insertBefore(quickNav, navbar.nextSibling);
    } else {
      document.body.prepend(quickNav);
    }
  }

  /**
   * Add keyboard shortcuts for quick navigation
   */
  function addKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      // Only trigger with Alt key, and not when typing in inputs
      if (!e.altKey || e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        return;
      }

      const shortcuts = {
        "h": "/",
        "c": "/catalog",
        "g": "/games",
        "t": "/trades",
        "i": "/my/inventory",
        "f": "/my/friends",
        "s": "/my/settings"
      };

      const key = e.key.toLowerCase();
      if (shortcuts[key]) {
        e.preventDefault();
        window.location.href = shortcuts[key];
      }
    });
  }

  /**
   * Enhance pagination with better UX
   */
  function enhancePagination() {
    const paginators = document.querySelectorAll(
      ".pagination:not(.btrk-pagination), .pager:not(.btrk-pagination)"
    );

    paginators.forEach((paginator) => {
      paginator.classList.add("btrk-pagination");
      paginator.classList.add("btrkorone-pagination");

      // Add scroll-to-top on page change
      const links = paginator.querySelectorAll("a");
      links.forEach((link) => {
        link.addEventListener("click", () => {
          setTimeout(() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
          }, 100);
        });
      });
    });
  }
})();
