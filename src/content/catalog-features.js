/**
 * BtrKorone - Catalog Koromons Badges (Plus tier)
 *
 * Adds a small blue gem badge on top of any catalog item card whose name
 * resolves to an item tracked on koromons.com (i.e. has a Value).
 *
 * Why a separate file: the existing trade-features.js is gated on the
 * Rex `tradeModal` feature; this Plus-tier feature touches different
 * surfaces (catalog grid, item detail page) and shouldn't piggy-back on
 * that gate.
 *
 * Pekora's CSS Module class names hash on every build (e.g.
 * `itemCard-0-2-247`), so we never hard-code class names. We anchor by
 * URL shape (`/catalog/<id>/...`) and walk up to a thumbnail-sized
 * container, the same way the play-button code does for game cards.
 */

(function BtrKoromonsCatalogBadges() {
  "use strict";

  // Pekora item URLs look like /catalog/12345/Item-Name. Anything else
  // matched by the prefix is filtered out by extractItemId.
  const CATALOG_HREF_RX = /^\/catalog\/(\d+)(?:\/|$)/i;

  // Common vendor prefixes Pekora returns ahead of the actual item name
  // (e.g. "Bundle: " on bundle items). Stripped before Koromons lookup.
  const VENDOR_PREFIX_RX = /^\s*(BIG|Bundle|Hat|Bundle)\s*:\s*/i;

  let observer = null;
  let scheduled = false;

  // Wait for the global state from main.js + KoromonsAPI to be ready.
  // Both are required; we re-poll until they exist.
  const waitForInit = setInterval(async () => {
    if (!window.__btrkorone) return;
    if (typeof KoromonsAPI === "undefined") return;
    clearInterval(waitForInit);

    if (!isFeatureActive()) {
      console.log("[BtrKorone/CatalogBadges] Feature not active.");
      return;
    }

    // Make sure Koromons data is loaded before the first scan; the API
    // is shared across content scripts so this may already be cached.
    try {
      await KoromonsAPI.load();
      console.log(
        `[BtrKorone/CatalogBadges] Active. Koromons items: ${KoromonsAPI.itemCount}.`
      );
    } catch (e) {
      console.warn("[BtrKorone/CatalogBadges] Koromons load failed:", e);
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
    findCatalogAnchors().forEach(anchor => {
      if (anchor.dataset.btrkBadgeChecked === "1") return;
      anchor.dataset.btrkBadgeChecked = "1";

      const itemId = extractItemId(anchor);
      const name = extractItemName(anchor);
      if (!name) return;

      const koromon = lookupKoromon(name);
      if (!koromon) return;

      const value = parseInt(koromon.Value || koromon.value || 0) || 0;
      if (value <= 0) return; // tracked but no value -> nothing to flag

      const host = findThumbHost(anchor) || anchor;
      if (host.querySelector(".btrkorone-koromons-badge")) return;

      ensurePositioned(host);
      host.appendChild(buildBadge(name, value, koromon, itemId));
      injected++;
    });

    if (injected > 0) {
      console.log(`[BtrKorone/CatalogBadges] Tagged ${injected} item(s).`);
    }
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
   * trade item lookups, etc. We tag all of them.
   */
  function findCatalogAnchors() {
    const out = [];
    document.querySelectorAll('a[href*="/catalog/"]').forEach(a => {
      const href = a.getAttribute("href") || "";
      if (CATALOG_HREF_RX.test(href)) out.push(a);
    });
    return out;
  }

  function extractItemId(anchor) {
    const href = anchor.getAttribute("href") || "";
    const m = href.match(CATALOG_HREF_RX);
    return m ? m[1] : null;
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
    const m = href.match(/^\/catalog\/\d+\/(.+?)(?:\/|$)/i);
    if (m) {
      try {
        return decodeURIComponent(m[1]).replace(/[-_]+/g, " ");
      } catch (_) { /* malformed URL, give up */ }
    }
    return null;
  }

  /**
   * Look up the item in the Koromons cache. We try the raw name first
   * and then the prefix-stripped variant ("Bundle: X" -> "X"); on a miss
   * we fall back to fuzzy search (LCS-based, threshold 0.6 inside
   * KoromonsAPI). Returns the matched item record or null.
   */
  function lookupKoromon(rawName) {
    if (!rawName) return null;
    const direct = KoromonsAPI.getByName(rawName);
    if (direct) return direct;

    const stripped = rawName.replace(VENDOR_PREFIX_RX, "").trim();
    if (stripped && stripped !== rawName) {
      const second = KoromonsAPI.getByName(stripped);
      if (second) return second;
    }

    if (typeof KoromonsAPI.fuzzySearch === "function") {
      return KoromonsAPI.fuzzySearch(stripped || rawName);
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
      anchor.querySelector("img")?.parentElement ||
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
  // Mutation observer (Pekora paginates / lazy-loads catalog grids)
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
