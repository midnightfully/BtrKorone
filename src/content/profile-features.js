/**
 * BtrKorone - Koromons Badge Display (Plus tier feature: koromonsBadgeDisplay)
 *
 * On Korone profile pages (/users/:userId/profile), fetches the user's
 * Koromons badge data and injects a "Koromons Badges" section directly
 * below the existing game "Badges" section, mirroring the RoliBadges
 * layout: a horizontal row of circular tiles with a green ring for
 * badges the user has earned and a grey ring for ones they have not.
 *
 * Data sources (all under https://www.koromons.com/api):
 *   GET /api/user-badges               -> definition catalog (id, name, icon)
 *   GET /api/users/:userId             -> earned-state map for this player
 *   (custom badges arrive embedded inside the per-user response;
 *    /api/users/:userId/user-badges is also available for the resolved form)
 *
 * The page is a single-page app: navigating between profiles does not
 * trigger a full reload, so we keep a MutationObserver alive on the body
 * and re-evaluate on every URL/path change. Stale sections (from a
 * previous profile) are removed when the userId changes.
 *
 * Selector strategy:
 *   Pekora's CSS Module class names are hashed per build, so we never
 *   pin them. We instead look for a heading whose textContent === "Badges"
 *   and walk up to the section container by following the DOM until the
 *   following sibling looks like the Statistics section. This survives
 *   class-name churn and matches the layout in the user's screenshot.
 */

(function BtrKoromonsBadgeDisplay() {
  "use strict";

  const PROFILE_PATH_RX = /\/users\/(\d+)\/profile/i;

  // Where the "See All" link points. The Koromons site uses /players/:id
  // for individual player profiles (matches their /api/users/:id and the
  // playerRanks collection referenced in the API docs). If the route ever
  // changes, this is the only place to update.
  const KOROMONS_PLAYER_URL = (id) => `https://www.koromons.com/players/${id}`;

  let observer = null;
  let scheduled = false;

  // Wait for the global state from main.js + KoromonsAPI to be ready.
  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    if (typeof KoromonsAPI === "undefined") return;
    clearInterval(waitForInit);

    if (!isFeatureActive()) {
      console.log("[BtrKorone/KoromonsBadgeDisplay] Feature not active.");
      return;
    }

    console.log("[BtrKorone/KoromonsBadgeDisplay] Active.");
    tryInject();
    startObserving();
  }, 50);

  // Hot-toggle handler: respond to popup toggling the feature on/off and
  // to tier changes (e.g. user upgrades to Plus mid-session).
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;

    if (msg.type === "FEATURE_TOGGLED" && msg.featureId === "koromonsBadgeDisplay") {
      if (msg.enabled && isFeatureActive()) {
        tryInject();
        startObserving();
      } else {
        stopObserving();
        removeAllSections();
      }
    }

    if (msg.type === "TIER_CHANGED") {
      if (isFeatureActive()) {
        tryInject();
        startObserving();
      } else {
        stopObserving();
        removeAllSections();
      }
    }
  });

  function isFeatureActive() {
    return !!(window.__btrkorone && window.__btrkorone.hasFeature("koromonsBadgeDisplay"));
  }

  function getProfileUserId() {
    const m = window.location.pathname.match(PROFILE_PATH_RX);
    return m ? m[1] : null;
  }

  // ============================================================
  // Injection entry point - safe to call repeatedly. Idempotent
  // for the current userId, removes stale sections from previous
  // profiles, and bails cleanly when the page isn't a profile.
  // ============================================================

  function tryInject() {
    if (!isFeatureActive()) return;

    const userId = getProfileUserId();
    if (!userId) {
      // Navigated away from a profile page - clean up any previously
      // injected section so it doesn't follow the user around.
      removeAllSections();
      return;
    }

    // SPA navigated to a different user's profile? Drop any sections
    // we injected for the previous one before the page tears them down.
    document.querySelectorAll(".btrkorone-koromons-badges-section").forEach(el => {
      if (el.dataset.uid !== userId) el.remove();
    });

    // Already have a section for this user.
    if (document.querySelector(`.btrkorone-koromons-badges-section[data-uid="${userId}"]`)) {
      return;
    }

    const badgesSection = findGameBadgesSection();
    if (!badgesSection) return; // page not yet rendered the Badges row

    injectKoromonsSection(userId, badgesSection);
  }

  /**
   * Locate the existing game "Badges" section on a Korone profile.
   *
   * We scan headings on the page for textContent === "Badges" and then
   * walk up parents until we find the wrapping section (heuristic: the
   * ancestor whose next sibling looks like the Statistics section).
   * Falls back to a few ancestor levels so we still inject something
   * sensible if Pekora restructures the DOM later.
   */
  function findGameBadgesSection() {
    const headings = document.querySelectorAll(
      'h1, h2, h3, h4, [class*="header"], [class*="title"], [class*="sectionTitle"]'
    );

    for (const h of headings) {
      const txt = (h.textContent || "").trim();
      // Plain "Badges" only - "Roblox Badges" / "RoliBadges" / our own
      // "Koromons Badges" must not match here.
      if (txt !== "Badges") continue;
      if (h.closest(".btrkorone-koromons-badges-section")) continue;

      const container = walkUpToSectionContainer(h);
      if (container) return container;
    }
    return null;
  }

  function walkUpToSectionContainer(heading) {
    let el = heading;
    for (let i = 0; el && i < 8; i++) {
      const next = el.nextElementSibling;
      if (next) {
        const headerInNext =
          next.querySelector && next.querySelector('h1, h2, h3, h4, [class*="header"], [class*="title"]');
        const nextLabel = headerInNext
          ? (headerInNext.textContent || "").trim()
          : ((next.textContent || "").trim().split("\n")[0] || "");
        if (/^Statistics/i.test(nextLabel)) {
          return el;
        }
      }
      el = el.parentElement;
    }
    // Fallback: 3 ancestors up - not perfect, but better than dropping
    // the section directly under the heading text node.
    return (
      (heading.parentElement && heading.parentElement.parentElement && heading.parentElement.parentElement.parentElement) ||
      heading.parentElement
    );
  }

  // ============================================================
  // Section construction
  // ============================================================

  async function injectKoromonsSection(userId, anchorAfter) {
    // Build a skeleton first so the user sees the section header
    // immediately. Real content is filled in once the API responses land.
    const section = buildSkeletonSection(userId);
    anchorAfter.insertAdjacentElement("afterend", section);

    try {
      const [definitions, userBadges] = await Promise.all([
        KoromonsAPI.getBadgeDefinitions(),
        KoromonsAPI.getUserBadges(userId)
      ]);

      // The user could have navigated away while we were awaiting -
      // bail if the section we created has been removed from the DOM
      // or if the URL no longer matches.
      if (!section.isConnected) return;
      if (getProfileUserId() !== userId) {
        section.remove();
        return;
      }

      renderBadges(section, definitions, userBadges);
    } catch (err) {
      console.error("[BtrKorone/KoromonsBadgeDisplay] Failed to load badges:", err);
      const grid = section.querySelector(".btrkorone-koromons-badges-grid");
      if (grid) {
        grid.innerHTML =
          '<div class="btrk-kb-empty">Could not load Koromons badges.</div>';
      }
    }
  }

  function buildSkeletonSection(userId) {
    const section = document.createElement("div");
    section.className = "btrkorone-koromons-badges-section";
    section.dataset.uid = userId;

    const header = document.createElement("div");
    header.className = "btrk-kb-header";

    const title = document.createElement("h3");
    title.className = "btrk-kb-title";
    title.textContent = "Koromons Badges";

    const seeAll = document.createElement("a");
    seeAll.className = "btrk-kb-seeall";
    seeAll.href = KOROMONS_PLAYER_URL(userId);
    seeAll.target = "_blank";
    seeAll.rel = "noopener noreferrer";
    seeAll.textContent = "See All \u2192";

    header.appendChild(title);
    header.appendChild(seeAll);

    const grid = document.createElement("div");
    grid.className = "btrkorone-koromons-badges-grid";

    const loading = document.createElement("div");
    loading.className = "btrk-kb-loading";
    loading.textContent = "Loading Koromons badges\u2026";
    grid.appendChild(loading);

    section.appendChild(header);
    section.appendChild(grid);
    return section;
  }

  function renderBadges(section, definitions, userBadges) {
    const grid = section.querySelector(".btrkorone-koromons-badges-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const earnedMap = (userBadges && userBadges.badges) || {};
    const customBadges = (userBadges && Array.isArray(userBadges.customBadges)) ? userBadges.customBadges : [];
    const hoardingBadges = (userBadges && Array.isArray(userBadges.hoardingBadges)) ? userBadges.hoardingBadges : [];

    // 1. Standard badges from the definition catalog. Render every entry
    //    so the grid mirrors RoliBadges (earned = green, locked = grey).
    if (Array.isArray(definitions) && definitions.length > 0) {
      definitions.forEach(def => {
        if (!def || !def.id) return;
        const earned = !!earnedMap[def.id];
        grid.appendChild(buildStandardTile(def, earned));
      });
    }

    // 2. Hoarding badges (per-item achievement badges). Always shown if
    //    present - they're earned by definition.
    hoardingBadges.forEach(hb => {
      if (!hb) return;
      grid.appendChild(buildHoardingTile(hb));
    });

    // 3. Custom badges (staff-issued). Render with their custom color ring.
    customBadges.forEach(cb => {
      if (!cb) return;
      grid.appendChild(buildCustomTile(cb));
    });

    if (!grid.children.length) {
      const empty = document.createElement("div");
      empty.className = "btrk-kb-empty";
      empty.textContent = "No Koromons badges to show for this user.";
      grid.appendChild(empty);
    }
  }

  // ============================================================
  // Tile builders - one per badge type so visual treatment can
  // diverge later without re-tangling the renderer.
  // ============================================================

  function buildStandardTile(def, earned) {
    const tile = document.createElement("div");
    tile.className = "btrk-kb-tile" + (earned ? " btrk-kb-earned" : " btrk-kb-locked");
    tile.title = (def.name || def.id) + (earned ? " (earned)" : " (not earned)");

    const circle = document.createElement("div");
    circle.className = "btrk-kb-circle";

    const icon = document.createElement("span");
    icon.className = "btrk-kb-icon";
    icon.textContent = def.icon || "\uD83C\uDFC5"; // medal as fallback
    circle.appendChild(icon);

    const label = document.createElement("div");
    label.className = "btrk-kb-label";
    label.textContent = def.name || def.id;

    tile.appendChild(circle);
    tile.appendChild(label);
    return tile;
  }

  function buildHoardingTile(hb) {
    const tile = document.createElement("div");
    tile.className = "btrk-kb-tile btrk-kb-earned btrk-kb-hoarding";
    const labelText = hb.name || hb.label || hb.id || "Hoarder";
    tile.title = labelText + " (hoarding badge)";

    const circle = document.createElement("div");
    circle.className = "btrk-kb-circle";

    const icon = document.createElement("span");
    icon.className = "btrk-kb-icon";
    icon.textContent = hb.icon || "\uD83D\uDC51"; // crown
    circle.appendChild(icon);

    const label = document.createElement("div");
    label.className = "btrk-kb-label";
    label.textContent = labelText;

    tile.appendChild(circle);
    tile.appendChild(label);
    return tile;
  }

  function buildCustomTile(cb) {
    const tile = document.createElement("div");
    tile.className = "btrk-kb-tile btrk-kb-earned btrk-kb-custom";

    const labelText = cb.label || cb.name || cb.id || "Custom";
    tile.title = labelText + " (custom badge)";

    const circle = document.createElement("div");
    circle.className = "btrk-kb-circle";
    if (cb.color) {
      // Override the green ring with the staff-assigned custom color so
      // donor / staff badges keep their identity from the Koromons site.
      circle.style.borderColor = cb.color;
      circle.style.background = hexToRgba(cb.color, 0.12);
    }

    const icon = document.createElement("span");
    icon.className = "btrk-kb-icon";
    icon.textContent = cb.icon || "\u2B50"; // star
    circle.appendChild(icon);

    const label = document.createElement("div");
    label.className = "btrk-kb-label";
    label.textContent = labelText;
    if (cb.color) label.style.color = cb.color;

    tile.appendChild(circle);
    tile.appendChild(label);
    return tile;
  }

  /**
   * Convert "#rrggbb" / "#rgb" to an rgba() string at the given alpha.
   * Falls back to the input string on parse failure so non-hex colors
   * (e.g. CSS named colors) are passed through untouched.
   */
  function hexToRgba(hex, alpha) {
    if (typeof hex !== "string") return hex;
    let h = hex.trim();
    if (h[0] !== "#") return hex;
    h = h.slice(1);
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    if (h.length !== 6) return hex;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ============================================================
  // Cleanup + observer
  // ============================================================

  function removeAllSections() {
    document.querySelectorAll(".btrkorone-koromons-badges-section").forEach(el => el.remove());
  }

  function startObserving() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        tryInject();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserving() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }
})();
