/**
 * BtrKorone - Premium Features (placeholder)
 *
 * All Plus/Rex feature implementations have been moved out for now.
 * Trade Modal lives in trade-features.js.
 * Future features will be added here one at a time.
 */

(function BtrPremiumFeatures() {
  "use strict";

  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);

    // Pre-load Koromons data so trade-features.js can use it
    if (typeof KoromonsAPI !== "undefined") {
      KoromonsAPI.load().then(loaded => {
        if (loaded) {
          console.log(`[BtrKorone] Koromons data loaded: ${KoromonsAPI.itemCount} items`);
          window.__btrkorone.koromons = KoromonsAPI;
        }
      });
    }
  }, 50);
})();
