/**
 * BtrKorone - Koromons Value Badges (Plus tier)
 *
 * Drops a small blue gem badge on top of any Pekora item card whose
 * asset ID or name resolves to a Koromons-tracked entry with a Value.
 *
 * Surfaces covered (anything on `*://*.pekora.zip/*`):
 *   - Catalog grid + search results + item-detail "more like this"
 *   - User profile inventory  (e.g. /users/42770/profile)
 *   - Trade item-picker dialogs that link to /catalog/<id>
 *
 * (The trade modal itself is handled separately in trade-features.js
 * so that file can use the per-item value calc it already does.)
 *
 * Resolution priority, per item:
 *   1. Numeric asset ID from the anchor's URL or `data-*` attribute
 *      -> KoromonsAPI.getById  (fastest, zero false-positives)
 *   2. Display name extracted from aria-label / title elements / alt /
 *      link text / URL slug -> KoromonsAPI.getByName, prefix-stripped
 *      retry, fuzzy fallback
 *   3. (Profile only) Thumbnail-image fallback for item rows that
 *      don't link to /catalog: pull the asset ID out of the image's
 *      src URL and try getById.
 *
 * Pekora's CSS Module class names hash on every build, so we never
 * pin selectors. Anchors are matched by URL shape, thumbnails by src
 * pattern + size sanity.
 */

(function BtrKoromonsBadges() {
  "use strict";

  // /catalog/12345 or /catalog/12345/Item-Slug. The trailing-slash form
  // covers the case where Pekora drops the slug entirely.
  const CATALOG_HREF_RX = /\/catalog\/(\d+)(?:\/|\?|#|$)/i;

  // Pekora item thumbnails embed the asset ID in the URL, e.g.
  //   /asset-thumbnail/12345/...
  //   /images/thumbnails/asset/12345.png
  //   /Thumbs/Avatar.ashx?...&AssetId=12345
  // We match any of these and capture the digits.
  const THUMB_ID_RX = /\/(?:asset-thumbnail|asset|item-thumbnail|thumbnails\/asset)\/(\d{2,12})(?:[\/.?]|$)/i;
  const THUMB_QS_RX = /[?&](?:assetId|AssetId|itemId|id)=(\d{2,12})(?:&|$)/i;

  // Common vendor prefixes Pekora returns ahead of the actual item name
  // (e.g. "Bundle: " on bundle items). Stripped before Koromons lookup.
  const VENDOR_PREFIX_RX = /^\s*(BIG|Bundle|Hat|Bundle)\s*:\s*/i;

  // Profile pages use a path like /users/42770/profile. We use this
  // hint to enable the (slightly more aggressive) thumbnail fallback
  // pass without risking false positives on the catalog grid.
  const PROFILE_PATH_RX = /\/users\/\d+\/profile/i;

  let observer = null;
  let scheduled = false;

  // Wait for the global state from main.js + KoromonsAPI to be ready.
  // Both are required; we re-poll until they exist.
  const waitForInit = setInterval(async () => {
    if (!window.__btrkorone) return;
    if (typeof KoromonsAPI === "undefined") return;
    clearInterval(waitForInit);

    if (!isFeatureActive()) {
      console.log("[BtrKorone/Badges] Feature not active.");
      return;
    }

    // Make sure Koromons data is loaded before the first scan; the API
    // is shared across content scripts so this may already be cached.
    try {
      await KoromonsAPI.load();
      console.log(
        `[BtrKorone/Badges] Active. Koromons items: ${KoromonsAPI.itemCount}.`
      );
    } catch (e) {
      console.warn("[BtrKorone/Badges] Koromons load failed:", e);
      return;
    }

    injectBadges();
    startObserving();
  }, 50);

  // Re-run injection / cleanup when the feature is toggled at runtime.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "FEATURE_TOGGLED" && msg.featureId === "koromonsBadges") {
      if (msg.enabled && isFeatureActive()) {
        injectBadges();
        startObserving();
      } else {
        stopObserving();
        removeAllBadges();
      }
    }
    if (msg && msg.type === "TIER_CHANGED") {
      // If the user dropped below Plus we lose access; if they went up we
      // may need to start scanning. Re-evaluate either way.
      if (isFeatureActive()) {
        injectBadges();
        startObserving();
      } else {
        stopObserving();
        removeAllBadges();
      }
    }
  });

  function isFeatureActive() {
    return !!(window.__btrkorone && window.__btrkorone.hasFeature("koromonsBadges"));
  }

  // ============================================================
  // Badge injection
  // ============================================================

  function injectBadges() {
    if (!isFeatureActive()) return;

    let injected = 0;

    // Pass 1: catalog-anchor items (catalog grid, profile inventory
    // when each row links to its catalog page, search results, etc.)
    findCatalogAnchors().forEach(anchor => {
      if (anchor.dataset.btrkBadgeChecked === "1") return;
      anchor.dataset.btrkBadgeChecked = "1";

      const itemId = extractIdFromAnchor(anchor);
      const name   = extractItemName(anchor);

      const koromon = lookupKoromon({ id: itemId, name });
      if (!koromon) return;

      const value = parseInt(koromon.Value || koromon.value || 0) || 0;
      if (value <= 0) return; // tracked but no value -> nothing to flag

      const host = findThumbHost(anchor) || anchor;
      if (host.querySelector(".btrkorone-koromons-badge")) return;

      ensurePositioned(host);
      host.appendChild(buildBadge(name || koromon.Name || "Item", value, koromon, itemId || koromon.itemId));
      injected++;
    });

    // Pass 2: thumbnail-only items on profile pages.
    // Inventory rows on Pekora's profile sometimes render as bare
    // <img> thumbnails inside a wrapper that isn't an <a>. We match
    // the asset ID out of the image URL and resolve via getById.
    // Strictly limited to /users/<id>/profile to avoid mistaking
    // friend avatars / badge icons / etc. for tradable items.
    if (PROFILE_PATH_RX.test(window.location.pathname)) {
      injected += injectThumbnailOnlyItems();
    }

    if (injected > 0) {
      console.log(`[BtrKorone/Badges] Tagged ${injected} item(s) on this view.`);
    }
  }

  function injectThumbnailOnlyItems() {
    let n = 0;
    document.querySelectorAll("img").forEach(img => {
      if (img.dataset.btrkBadgeChecked === "1") return;

      const id = extractIdFromImg(img);
      if (!id) return;

      // Skip images that are already inside a catalog anchor - pass 1
      // handled them and the badge would double-render.
      if (img.closest('a[href*="/catalog/"]')) return;

      // Skip avatars / badge sized images. Item thumbnails on profile
      // are typically 60-200 px square.
      const r = img.getBoundingClientRect();
      if (r.width < 40 || r.width > 260 || r.height < 40 || r.height > 260) return;

      img.dataset.btrkBadgeChecked = "1";

      const koromon = KoromonsAPI.getById(id);
      if (!koromon) return;

      const value = parseInt(koromon.Value || koromon.value || 0) || 0;
      if (value <= 0) return;

      const host = img.parentElement || img;
      if (host.querySelector(".btrkorone-koromons-badge")) return;

      ensurePositioned(host);
      host.appendChild(buildBadge(koromon.Name || "Item", value, koromon, id));
      n++;
    });
    return n;
  }

  function removeAllBadges() {
    document.querySelectorAll(".btrkorone-koromons-badge").forEach(el => el.remove());
    document.querySelectorAll('[data-btrk-badge-checked="1"]').forEach(el => {
      delete el.dataset.btrkBadgeChecked;
    });
  }

  /**
   * Find every anchor on the page that points at a catalog item.
   * Pekora reuses this URL pattern in many places: catalog grid, search
   * results, marketplace listings, item detail "more like this" rows,
   * trade item lookups, and profile inventory rows. We tag all of them.
   */
  function findCatalogAnchors() {
    const out = [];
    document.querySelectorAll('a[href*="/catalog/"]').forEach(a => {
      const href = a.getAttribute("href") || "";
      if (CATALOG_HREF_RX.test(href)) out.push(a);
    });
    return out;
  }

  /**
   * Extract the numeric asset ID from an anchor. Tries, in order:
   *   1. /catalog/<id> in the href
   *   2. data-id / data-item-id / data-asset-id on the anchor itself
   *   3. Same data-* attrs on a parent (some grids put the ID on the row)
   *   4. Any thumbnail image inside the anchor whose URL contains an ID
   */
  function extractIdFromAnchor(anchor) {
    const href = anchor.getAttribute("href") || "";
    const m = href.match(CATALOG_HREF_RX);
    if (m) return m[1];

    const fromData =
      anchor.dataset.itemId ||
      anchor.dataset.id ||
      anchor.dataset.assetId;
    if (fromData && /^\d+$/.test(fromData)) return fromData;

    let p = anchor.parentElement;
    for (let i = 0; p && i < 3; i++) {
      const v = p.dataset && (p.dataset.itemId || p.dataset.id || p.dataset.assetId);
      if (v && /^\d+$/.test(v)) return v;
      p = p.parentElement;
    }

    const img = anchor.querySelector("img");
    if (img) {
      const fromImg = extractIdFromImg(img);
      if (fromImg) return fromImg;
    }
    return null;
  }

  /** Match the asset ID out of any Pekora thumbnail image URL. */
  function extractIdFromImg(img) {
    const src = img.getAttribute("src") || "";
    if (!src) return null;
    const m1 = src.match(THUMB_ID_RX);
    if (m1) return m1[1];
    const m2 = src.match(THUMB_QS_RX);
    if (m2) return m2[1];
    return null;
  }

  /**
   * Try several paths to recover the item's display name. Pekora's
   * catalog cards usually expose it in the link text or a child title
   * element; if neither is present, fall back to the URL slug.
   */
  function extractItemName(anchor) {
    // Aria label is the most reliable when present.
    const aria = anchor.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();

    // Common title-shaped children inside the card.
    const titleSel = [
      '[class*="itemName"]',
      '[class*="itemTitle"]',
      '[class*="item-name"]',
      '[class*="item-title"]',
      '[class*="cardName"]',
      '[class*="cardTitle"]',
      '[class*="catalogItemName"]',
      "h2", "h3", "h4", "h5"
    ].join(",");
    const title = anchor.querySelector(titleSel);
    if (title && title.textContent && title.textContent.trim()) {
      return title.textContent.trim();
    }

    // Fall back to image alt text.
    const img = anchor.querySelector("img[alt]");
    if (img && img.alt && img.alt.trim()) return img.alt.trim();

    // Last resort: the link's own text. Strip prices / counts that often
    // appear on the same line by keeping only the first non-empty line.
    if (anchor.textContent) {
      const lines = anchor.textContent.split("\n").map(s => s.trim()).filter(Boolean);
      if (lines.length) return lines[0];
    }

    // Decode the URL slug as a final fallback (e.g. "Living-Art-Starry-Night").
    const href = anchor.getAttribute("href") || "";
    const m = href.match(/\/catalog\/\d+\/(.+?)(?:\/|\?|#|$)/i);
    if (m) {
      try {
        return decodeURIComponent(m[1]).replace(/[-_]+/g, " ");
      } catch (_) { /* malformed URL, give up */ }
    }
    return null;
  }

  /**
   * Look up an item in the Koromons cache. ID-based resolution wins
   * when present (it's a single hashmap hit and can never false-positive
   * on a name collision). Otherwise we walk the same name path the
   * trade modal uses: raw name, prefix-stripped name, fuzzy fallback.
   */
  function lookupKoromon({ id, name }) {
    if (id && typeof KoromonsAPI.getById === "function") {
      const byId = KoromonsAPI.getById(id);
      if (byId) return byId;
    }
    if (!name) return null;

    const direct = KoromonsAPI.getByName(name);
    if (direct) return direct;

    const stripped = name.replace(VENDOR_PREFIX_RX, "").trim();
    if (stripped && stripped !== name) {
      const second = KoromonsAPI.getByName(stripped);
      if (second) return second;
    }

    if (typeof KoromonsAPI.fuzzySearch === "function") {
      return KoromonsAPI.fuzzySearch(stripped || name);
    }
    return null;
  }

  /**
   * Walk the anchor's subtree for the most thumbnail-shaped child so the
   * badge ends up over the item image, not over the entire card. Falls
   * back to the anchor itself if no obvious thumbnail container exists.
   */
  function findThumbHost(anchor) {
    return (
      anchor.querySelector(
        '[class*="itemThumb"], [class*="thumbContainer"], [class*="itemImage"], ' +
        '[class*="itemCardThumb"], [class*="card-thumb"], [class*="cardImage"]'
      ) ||
      (anchor.querySelector("img") && anchor.querySelector("img").parentElement) ||
      null
    );
  }

  function ensurePositioned(el) {
    if (!el) return;
    if (getComputedStyle(el).position === "static") {
      el.style.position = "relative";
    }
  }

  // ============================================================
  // Badge DOM
  // ============================================================

  /**
   * Inline SVG so we don't need to ship an extra asset and so the badge
   * renders identically across themes. The gem is solid-colored
   * (no <defs>/gradient IDs) which means we can repeat it many times on
   * the page without ID collisions.
   */
  const GEM_SVG = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6 3 L18 3 L22 9 L12 22 L2 9 Z" fill="#0ea5e9" stroke="#082f49" stroke-width="0.6"/>
      <path d="M6 3 L12 9 L18 3 Z" fill="#7dd3fc"/>
      <path d="M2 9 L22 9 M12 9 L12 22" stroke="#082f49" stroke-width="0.4" fill="none" opacity="0.55"/>
      <circle cx="9" cy="6" r="0.9" fill="#ffffff" opacity="0.9"/>
    </svg>
  `;

  function buildBadge(name, value, koromon, itemId) {
    const wrap = document.createElement("div");
    wrap.className = "btrkorone-koromons-badge";
    wrap.innerHTML = GEM_SVG;

    const tooltipParts = [name, `Value: ${value.toLocaleString()}`];
    const rap = parseInt(koromon.RAP || koromon.rap || 0) || 0;
    if (rap > 0) tooltipParts.push(`RAP: ${rap.toLocaleString()}`);
    if (koromon.Demand) tooltipParts.push(`Demand: ${koromon.Demand}`);
    if (itemId) tooltipParts.push(`ID: ${itemId}`);
    wrap.title = tooltipParts.join("\n");

    return wrap;
  }

  // ============================================================
  // Mutation observer (Pekora paginates / lazy-loads grids and
  // profile inventory rows)
  // ============================================================

  function startObserving() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        injectBadges();
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
