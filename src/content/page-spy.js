/**
 * BtrKorone - Page-context fetch/XHR spy
 *
 * Loaded into Pekora's main JavaScript world TWO ways for redundancy:
 *
 *   1. As a content_script with `world: "MAIN", run_at: "document_start"`
 *      (Chrome 102+ / modern Chromium - the preferred path).
 *   2. Programmatically via a <script> tag inserted by the isolated
 *      content script (works on every Chromium browser regardless of
 *      MV3 quirks - the fallback path).
 *
 * Whichever loads first wins; the second is a no-op thanks to the
 * __btrkPageSpyInstalled guard.
 *
 * What it does:
 *   - Wraps window.fetch and XMLHttpRequest.open BEFORE Pekora's bundle
 *     captures references to them.
 *   - When Pekora calls /apisite/trades/v1/trades/{id}, captures the
 *     {id} from the URL AND the full JSON response, then relays both
 *     across the isolation boundary via window.postMessage.
 *   - The isolated content script (trade-features.js) listens for
 *     those messages and uses the cached detail directly when it's
 *     time to inject the modal - eliminating the need for a follow-up
 *     fetch and any cache-lookup logic.
 */
(function btrKoronePageSpy() {
  "use strict";

  if (window.__btrkPageSpyInstalled) return;
  window.__btrkPageSpyInstalled = true;

  const TRADE_RX = /\/trades\/v\d+\/trades\/(\d{3,12})(?:[^\d]|$)/;
  const ORIGIN = window.location.origin;

  function relay(payload) {
    try {
      window.postMessage(Object.assign({ __btrkorone: true }, payload), ORIGIN);
    } catch (_) {}
  }

  // --- fetch ----------------------------------------------------------------
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function btrkSpyFetch(input, init) {
      let tradeId = null;
      try {
        const url = typeof input === "string"
          ? input
          : (input && typeof input.url === "string" ? input.url : "");
        const m = url && url.match(TRADE_RX);
        if (m) tradeId = m[1];
      } catch (_) {}

      const promise = origFetch.apply(this, arguments);

      if (tradeId) {
        relay({ type: "TRADE_FETCH", tradeId });
        // Try to capture the JSON body without disrupting the page's own
        // consumption of the response. We clone to avoid lock-stream errors.
        promise.then((response) => {
          try {
            if (!response || !response.ok) return;
            const cloned = response.clone();
            cloned.json().then((data) => {
              if (data && (data.id || data.offers)) {
                relay({
                  type: "TRADE_DETAIL",
                  tradeId: String(data.id || tradeId),
                  detail: data
                });
              }
            }).catch(() => {});
          } catch (_) {}
        }, () => {});
      }
      return promise;
    };
  }

  // --- XMLHttpRequest -------------------------------------------------------
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  if (typeof origOpen === "function") {
    XMLHttpRequest.prototype.open = function btrkSpyXhrOpen(method, url) {
      try {
        if (typeof url === "string") {
          const m = url.match(TRADE_RX);
          if (m) {
            this.__btrkTradeId = m[1];
            relay({ type: "TRADE_FETCH", tradeId: m[1] });
          }
        }
      } catch (_) {}
      return origOpen.apply(this, arguments);
    };
  }
  if (typeof origSend === "function") {
    XMLHttpRequest.prototype.send = function btrkSpyXhrSend() {
      const tradeId = this.__btrkTradeId;
      if (tradeId) {
        this.addEventListener("load", function btrkSpyXhrLoad() {
          try {
            const text = this.responseText || "";
            if (!text) return;
            const data = JSON.parse(text);
            if (data && (data.id || data.offers)) {
              relay({
                type: "TRADE_DETAIL",
                tradeId: String(data.id || tradeId),
                detail: data
              });
            }
          } catch (_) {}
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();
