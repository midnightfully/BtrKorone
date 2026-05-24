/**
 * BtrKorone - Page-context fetch/XHR spy (MAIN world)
 *
 * Runs in the page's main world at document_start so we can wrap
 * window.fetch and XMLHttpRequest.open BEFORE Pekora's bundle captures
 * references to them. When Pekora calls
 *   GET /apisite/trades/v1/trades/{id}
 * we capture the {id} and relay it to the isolated content script via
 * window.postMessage, where trade-features.js uses it as a definitive
 * trade-ID hint for modal injection.
 *
 * This solves the case where the trade ID lives only inside a JS closure
 * on the trade-row click handler and never surfaces in any DOM attribute,
 * making post-hoc DOM scraping impossible.
 */
(function btrKoronePageSpy() {
  "use strict";

  if (window.__btrkPageSpyInstalled) return;
  window.__btrkPageSpyInstalled = true;

  // Match /trades/v1/trades/12345 anywhere in a URL (with optional v2/etc).
  const TRADE_RX = /\/trades\/v\d+\/trades\/(\d{3,12})(?:[^\d]|$)/;

  function relay(id) {
    if (!id) return;
    try {
      window.postMessage(
        { __btrkorone: true, type: "TRADE_FETCH", tradeId: String(id) },
        window.location.origin
      );
    } catch (_) {}
  }

  // ---- fetch ----
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function btrkSpyFetch(input, init) {
      try {
        const url = typeof input === "string"
          ? input
          : (input && typeof input.url === "string" ? input.url : "");
        const m = url && url.match(TRADE_RX);
        if (m) relay(m[1]);
      } catch (_) {}
      return origFetch.apply(this, arguments);
    };
  }

  // ---- XMLHttpRequest ----
  const origOpen = XMLHttpRequest.prototype.open;
  if (typeof origOpen === "function") {
    XMLHttpRequest.prototype.open = function btrkSpyXhrOpen(method, url) {
      try {
        if (typeof url === "string") {
          const m = url.match(TRADE_RX);
          if (m) relay(m[1]);
        }
      } catch (_) {}
      return origOpen.apply(this, arguments);
    };
  }
})();
