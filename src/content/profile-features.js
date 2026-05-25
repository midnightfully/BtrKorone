/**
 * BtrKorone - Koromons Badge Display (Plus tier feature: koromonsBadgeDisplay)
 *
 * On Korone profile pages (/users/:userId/profile), fetches the user's
 * Koromons badge data and injects a "Koromons Badges" section directly
 * below the existing game "Badges" section, mirroring how the Koromons
 * site itself displays badges on /player/:id - we render ONLY the
 * badges the player currently owns, each as a circular tile with the
 * earned-style green ring. Locked / not-yet-earned badges are omitted
 * from the grid entirely so the section stays compact.
 *
 * Data source (https://www.koromons.com/api):
 *   GET /api/users/:userId   -> {
 *     userId,
 *     badges: { <id>: bool, ... },   // standard badges, flat boolean map
 *     hoardingBadges: [...],         // per-item hoarder badges
 *     customBadges: [...]            // staff-issued (label, color, icon)
 *   }
 *
 * NOTE on the badge "catalog":
 *   The Koromons API documentation lists a `GET /api/user-badges`
 *   endpoint that supposedly returns badge definitions (id, name, icon).
 *   The live endpoint actually requires a userId and returns per-user
 *   data, NOT a catalog. There is no public catalog endpoint, and the
 *   per-user response carries only badge IDs - no names and no icons.
 *
 *   So we ship a static `BADGE_DISPLAY` map below with human-readable
 *   names and emoji icons keyed by the badge IDs the API uses. Any new
 *   ID Koromons adds in the future will still render: it just falls
 *   back to a humanized form of the ID and a generic medal icon.
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

  // Where the "See All" link points. The Koromons site uses /player/:id
  // (singular) for individual player profiles - confirmed via the Referer
  // header on a real /api/users/:id/user-badges request from koromons.com.
  // If the route ever changes, this is the only place to update.
  const KOROMONS_PLAYER_URL = (id) => `https://www.koromons.com/player/${id}`;

  /**
   * Static display catalog. Keys are the badge IDs returned by
   *   GET https://www.koromons.com/api/users/:userId
   * and the order here is the order tiles will be rendered in. Anything
   * the API returns that is missing from this map is rendered through
   * humanizeBadgeId() with a generic medal icon.
   *
   * Categories (purely for ordering / readability):
   *   1. RAP tier badges  - hundredK -> twentyMillion
   *   2. Collection badges
   *   3. Serial-related badges
   *   4. Trading activity badges
   *   5. Identity / fun
   */
  // Real Koromons SVG icons live under https://www.koromons.com/svg/<name>.svg
  // The filename for each badge has been verified against the live site;
  // any entry without iconUrl falls back to its `icon` emoji until the
  // matching SVG path is confirmed.
  const KOROMONS_SVG = (name) => `https://www.koromons.com/svg/${name}.svg`;

  const BADGE_DISPLAY = {
    // RAP tiers - SVG paths not yet confirmed; emoji fallback for now.
    hundredK:         { name: "100K+",             icon: "\uD83D\uDCAF" },
    fiveHundredK:     { name: "500K+",             icon: "\uD83D\uDCB0" },
    oneMillion:       { name: "1M+",               icon: "\uD83D\uDCB5" },
    twoMillion:       { name: "2M+",               icon: "\uD83D\uDCB4" },
    fiveMillion:      { name: "5M+",               icon: "\uD83D\uDCB6" },
    tenMillion:       { name: "10M+",              icon: "\uD83D\uDCB7" },
    twentyMillion:    { name: "20M+",              icon: "\uD83C\uDFE6" },

    // Collection - all five rarity-based badges have official SVGs.
    accessorized:     { name: "Accessorized",      icon: "\uD83C\uDFA9",       iconUrl: KOROMONS_SVG("accessorized") },
    collector:        { name: "Collector",         icon: "\uD83D\uDCBC",       iconUrl: KOROMONS_SVG("collector") },
    rareOwner:        { name: "Rare Owner",        icon: "\uD83D\uDC8E",       iconUrl: KOROMONS_SVG("rare-owner") },
    rareEnthusiast:   { name: "Rare Enthusiast",   icon: "\uD83D\uDD37" }, // SVG path TBD
    rareSupremist:    { name: "Rare Supremist",    icon: "\uD83D\uDD2E",       iconUrl: KOROMONS_SVG("rare-supremist") },
    dominator:        { name: "Dominator",         icon: "\uD83D\uDC51" }, // SVG path TBD
    sparkly:          { name: "Sparkly",           icon: "\u2728",             iconUrl: KOROMONS_SVG("sparkle-collector") },
    federated:        { name: "Federated",         icon: "\uD83D\uDEE1\uFE0F" }, // SVG path TBD

    // Serials
    lowSerial:        { name: "Low Serial",        icon: "\uD83D\uDD22",       iconUrl: KOROMONS_SVG("low-serial") },
    sequentialSerial: { name: "Sequential Serial", icon: "\uD83D\uDCC8",       iconUrl: KOROMONS_SVG("sequential-serial") },
    serialOne:        { name: "Serial #1",         icon: "1\uFE0F\u20E3" }, // SVG path TBD

    // Trading activity - SVG paths TBD
    tradeAdvertiser:  { name: "Trade Advertiser",  icon: "\uD83D\uDCE2" },
    frequentTrader:   { name: "Frequent Trader",   icon: "\uD83D\uDD04" },
    activeTrader:     { name: "Active Trader",     icon: "\u26A1"        },
    boundlessTrader:  { name: "Boundless Trader",  icon: "\u267E\uFE0F" },

    // Identity / fun
    luckycat:         { name: "Lucky Cat",         icon: "\uD83D\uDC08",       iconUrl: KOROMONS_SVG("lucky-cat") },
    verified:         { name: "Verified",          icon: "\u2705"        }  // SVG path TBD
  };

  // Display order = insertion order of BADGE_DISPLAY. Snapshotted now so
  // adding new keys at runtime would not shift existing tiles around.
  const BADGE_ORDER = Object.keys(BADGE_DISPLAY);

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
    // immediately. Real content is filled in once the API response lands.
    const section = buildSkeletonSection(userId);
    anchorAfter.insertAdjacentElement("afterend", section);

    try {
      const userBadges = await KoromonsAPI.getUserBadges(userId);

      // The user could have navigated away while we were awaiting -
      // bail if the section we created has been removed from the DOM
      // or if the URL no longer matches.
      if (!section.isConnected) return;
      if (getProfileUserId() !== userId) {
        section.remove();
        return;
      }

      renderBadges(section, userBadges);
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

  function renderBadges(section, userBadges) {
    const grid = section.querySelector(".btrkorone-koromons-badges-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const earnedMap = (userBadges && userBadges.badges && typeof userBadges.badges === "object")
      ? userBadges.badges
      : {};
    const customBadges = (userBadges && Array.isArray(userBadges.customBadges)) ? userBadges.customBadges : [];
    const hoardingBadges = (userBadges && Array.isArray(userBadges.hoardingBadges)) ? userBadges.hoardingBadges : [];

    // Render order:
    //   1. Every EARNED badge ID we have curated display metadata for,
    //      in BADGE_ORDER. Locked badges are skipped entirely so the
    //      section only shows what the player actually owns - matching
    //      how koromons.com/player/:id displays its own badge row.
    //   2. Any earned badge IDs that the API returned but we don't yet
    //      know about - render them through humanizeBadgeId() so future
    //      Koromons additions don't disappear silently.
    //   3. Hoarding badges (always earned by definition).
    //   4. Custom badges (staff-issued, with custom color).

    const seenIds = new Set();

    BADGE_ORDER.forEach(id => {
      seenIds.add(id);
      if (!earnedMap[id]) return; // skip badges the player hasn't earned
      const display = BADGE_DISPLAY[id];
      grid.appendChild(buildStandardTile(id, display, true));
    });

    Object.keys(earnedMap).forEach(id => {
      if (seenIds.has(id)) return;
      seenIds.add(id);
      if (!earnedMap[id]) return; // skip not-earned unknowns too
      // Unknown ID - render with auto-generated label + medal icon so
      // the tile is not lost. Console-warn so we know to add metadata.
      console.warn(`[BtrKorone/KoromonsBadgeDisplay] Unknown badge id: ${id} - falling back to humanized label.`);
      grid.appendChild(buildStandardTile(id, null, true));
    });

    hoardingBadges.forEach(hb => {
      if (!hb) return;
      grid.appendChild(buildHoardingTile(hb));
    });

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

  function buildStandardTile(id, display, earned) {
    const tile = document.createElement("div");
    tile.className = "btrk-kb-tile" + (earned ? " btrk-kb-earned" : " btrk-kb-locked");
    const labelText = (display && display.name) || humanizeBadgeId(id);
    tile.title = labelText + (earned ? " (earned)" : " (not earned)");

    const circle = document.createElement("div");
    circle.className = "btrk-kb-circle";

    // Prefer an actual icon image if BADGE_DISPLAY supplies one; this is
    // the path we'll switch to once Koromons' real icon URLs are wired
    // up. Until then we fall back to the curated emoji and finally to
    // a generic medal so unknown IDs still render.
    if (display && display.iconUrl) {
      const img = document.createElement("img");
      img.className = "btrk-kb-icon btrk-kb-icon-img";
      img.src = display.iconUrl;
      img.alt = labelText;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      circle.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "btrk-kb-icon";
      icon.textContent = (display && display.icon) || "\uD83C\uDFC5"; // medal fallback
      circle.appendChild(icon);
    }

    const label = document.createElement("div");
    label.className = "btrk-kb-label";
    label.textContent = labelText;

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

    if (hb.iconUrl || (typeof hb.icon === "string" && /^https?:\/\//.test(hb.icon))) {
      const img = document.createElement("img");
      img.className = "btrk-kb-icon btrk-kb-icon-img";
      img.src = hb.iconUrl || hb.icon;
      img.alt = labelText;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      circle.appendChild(img);
    } else if (!hb.icon) {
      // No icon supplied - fall back to Koromons' generic hoarder.svg.
      const img = document.createElement("img");
      img.className = "btrk-kb-icon btrk-kb-icon-img";
      img.src = "https://www.koromons.com/svg/hoarder.svg";
      img.alt = labelText;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      circle.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "btrk-kb-icon";
      icon.textContent = hb.icon;
      circle.appendChild(icon);
    }

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

    if (cb.iconUrl || (typeof cb.icon === "string" && /^https?:\/\//.test(cb.icon))) {
      const img = document.createElement("img");
      img.className = "btrk-kb-icon btrk-kb-icon-img";
      img.src = cb.iconUrl || cb.icon;
      img.alt = labelText;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      circle.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "btrk-kb-icon";
      icon.textContent = cb.icon || "\u2B50"; // star
      circle.appendChild(icon);
    }

    const label = document.createElement("div");
    label.className = "btrk-kb-label";
    label.textContent = labelText;
    if (cb.color) label.style.color = cb.color;

    tile.appendChild(circle);
    tile.appendChild(label);
    return tile;
  }

  /**
   * Turn a camelCase badge ID into a human-readable label.
   * Used as a fallback when the API returns an ID that isn't in
   * BADGE_DISPLAY yet.
   *   "rareEnthusiast" -> "Rare Enthusiast"
   *   "tenMillion"     -> "Ten Million"
   */
  function humanizeBadgeId(id) {
    if (!id || typeof id !== "string") return "Badge";
    return id
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\w/, c => c.toUpperCase())
      .replace(/\s\w/g, c => c.toUpperCase());
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
