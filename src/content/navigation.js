/**
 * BtrKorone - Quick Navigation
 * Adds sticky nav bar, keyboard shortcuts, and pagination improvements
 */

(function BtrNavigation() {
  "use strict";

  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);

    if (!window.__btrkorone.hasFeature("quickNavigation")) return;
    init();
  }, 50);

  function init() {
    addQuickNavBar();
    addKeyboardShortcuts();
    enhancePagination();
  }

  function addQuickNavBar() {
    if (document.querySelector(".btrkorone-quicknav")) return;

    const navLinks = [
      { label: "Home", href: "/", key: "h" },
      { label: "Catalog", href: "/catalog", key: "c" },
      { label: "Games", href: "/games", key: "g" },
      { label: "Trades", href: "/trades", key: "t" },
      { label: "Inventory", href: "/my/inventory", key: "i" },
      { label: "Friends", href: "/my/friends", key: "f" },
      { label: "Groups", href: "/groups", key: "r" },
      { label: "Settings", href: "/my/settings", key: "s" }
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
      a.title = `${link.label} (Alt+${link.key.toUpperCase()})`;

      if (window.location.pathname === link.href ||
          (link.href !== "/" && window.location.pathname.startsWith(link.href))) {
        a.classList.add("active");
      }

      inner.appendChild(a);
    });

    quickNav.appendChild(inner);

    // Insert after navbar or at top
    const navbar = document.querySelector(".navbar, nav, #navigation, .nav-container");
    if (navbar && navbar.parentNode) {
      navbar.parentNode.insertBefore(quickNav, navbar.nextSibling);
    } else {
      document.body.prepend(quickNav);
    }
  }

  function addKeyboardShortcuts() {
    const shortcuts = {
      "h": "/",
      "c": "/catalog",
      "g": "/games",
      "t": "/trades",
      "i": "/my/inventory",
      "f": "/my/friends",
      "r": "/groups",
      "s": "/my/settings"
    };

    document.addEventListener("keydown", (e) => {
      if (!e.altKey) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;

      const key = e.key.toLowerCase();
      if (shortcuts[key]) {
        e.preventDefault();
        window.location.href = shortcuts[key];
      }
    });
  }

  function enhancePagination() {
    const paginators = document.querySelectorAll(
      ".pagination:not(.btrk-pagination), .pager:not(.btrk-pagination)"
    );

    paginators.forEach((paginator) => {
      paginator.classList.add("btrk-pagination", "btrkorone-pagination");

      const links = paginator.querySelectorAll("a");
      links.forEach((link) => {
        link.addEventListener("click", () => {
          setTimeout(() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
          }, 150);
        });
      });
    });
  }
})();
