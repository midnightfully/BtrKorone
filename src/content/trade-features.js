/**
 * BtrKorone - Trade Modal Replacement (Rex tier)
 *
 * Architecture (v2.5+, inspired by the Korone All-in-One userscript by Dior):
 *
 * Instead of injecting badges/banners INTO Pekora's native trade modal (which
 * was fragile due to animation timing, hashed CSS selectors, modal reuse, and
 * race conditions), we own the entire trade UI on /My/Trades.aspx:
 *
 *   1. Wait for Pekora's trades table + type selector.
 *   2. Fetch all trades of the selected type via the Pekora API.
 *   3. Hide Pekora's native rows. Inject our own rows + custom "View Details"
 *      button (intercepted with capture-phase + stopImmediatePropagation so
 *      Pekora's native handler never fires).
 *   4. On click, open our own modal: sidebar (avatar, partner, value diff,
 *      per-side Korone Value / RAP / Robux breakdown), content (give &
 *      receive item grids with totals), footer (Accept / Counter / Decline
 *      that POST directly to /apisite/trades/v1/trades/{id}/{action}).
 *
 * No more "sometimes broken layout" - we control every pixel.
 */

(function BtrTradeModalFeature() {
  "use strict";

  const TRADE_PAGES = ["/My/Trades.aspx", "/My/Trades", "/trades"];
  const BASE = "https://www.pekora.zip";
  const TRADE_API = `${BASE}/apisite/trades/v1/trades`;
  const THUMB_API = `${BASE}/apisite/thumbnails/v1`;

  let myUserId = null;
  let csrfToken = "";

  // ============================================================
  // INIT
  // ============================================================

  function isTradePage() {
    return TRADE_PAGES.some(p =>
      window.location.pathname.toLowerCase().includes(p.toLowerCase()));
  }

  const waitForInit = setInterval(() => {
    if (!window.__btrkorone) return;
    clearInterval(waitForInit);
    if (!window.__btrkorone.hasFeature("tradeModal")) return;
    if (!isTradePage()) return;
    init();
  }, 100);

  async function init() {
    if (typeof KoromonsAPI !== "undefined") await KoromonsAPI.load();

    if (typeof PekoraAPI !== "undefined") {
      const me = await PekoraAPI.getAuthenticatedUser();
      if (me) myUserId = me.id;
    }
    if (!myUserId) {
      try {
        const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
        if (status && status.userId) myUserId = Number(status.userId);
      } catch (e) {}
    }
    if (!myUserId) {
      console.warn("[BtrKorone/Trades] Could not determine current user ID; aborting.");
      return;
    }

    console.log("[BtrKorone/Trades] Init for user:", myUserId);
    installTradesPageHandlers();
  }

  // ============================================================
  // TRADES PAGE: hide native rows, inject our own
  // ============================================================

  function installTradesPageHandlers() {
    // Pekora's CSS modules use hashed class names like `tradeTypeActions-0-2-50`
    // and `table-0-2-51`. The hashes change as Pekora redeploys, so we match
    // permissively on the prefix.
    waitFor(
      "select[class*='tradeTypeActions-']",
      (select) => waitFor(
        "table[class*='table-'] tbody",
        (tbody) => {
          select.addEventListener("change", () => loadTrades(select.value, tbody));
          loadTrades(select.value, tbody);
        }
      )
    );

    // Capture-phase click intercept for our custom View Details button. Has to
    // run BEFORE Pekora's own handler so we can stopImmediatePropagation and
    // keep the native modal from opening alongside ours.
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".tm-view-btn");
      if (!btn) return;
      const row = btn.closest("tr.tm-injected");
      if (!row || !row._tmTrade) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      openModal(row._tmTrade);
    }, /* capture = */ true);
  }

  /**
   * Resolve a selector now or wait for it to appear via MutationObserver.
   * The Pekora trades page is server-rendered, but ASP.NET can still defer
   * the table render briefly on slow loads.
   */
  function waitFor(selector, callback) {
    const el = document.querySelector(selector);
    if (el) return callback(el);
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        observer.disconnect();
        callback(found);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function loadTrades(type, tbody) {
    clearInjected(tbody);

    const loading = document.createElement("tr");
    loading.className = "tm-loading-row";
    loading.innerHTML = `<td colspan="5" style="text-align:center;padding:10px;color:#888">Loading ${escapeHtml(type)} trades…</td>`;
    tbody.appendChild(loading);

    let trades;
    try {
      trades = await fetchAllTrades(type);
    } catch (e) {
      loading.innerHTML = `<td colspan="5" style="text-align:center;padding:10px;color:#f87171">Failed to load: ${escapeHtml(e.message)}</td>`;
      return;
    }
    loading.remove();

    if (trades.length === 0) {
      const empty = document.createElement("tr");
      empty.className = "tm-loading-row";
      empty.innerHTML = `<td colspan="5" style="text-align:center;padding:10px;color:#888">No ${escapeHtml(type)} trades</td>`;
      tbody.appendChild(empty);
      return;
    }

    // Hide Pekora's native rows so our injected ones are the only visible
    // ones. Done AFTER our rows are appended so the table never flashes empty.
    trades.forEach(trade => tbody.appendChild(buildTradeRow(trade)));
    tbody.querySelectorAll("tr:not(.tm-injected):not(.tm-loading-row)").forEach(el => {
      el.style.display = "none";
    });
  }

  /**
   * Walk the cursor pagination on /apisite/trades/v1/trades/{type}.
   * Reuses PekoraAPI._fetchJSON so credentials + error logging are consistent.
   */
  async function fetchAllTrades(type) {
    const all = [];
    let cursor = "";
    while (true) {
      const url = `${TRADE_API}/${encodeURIComponent(type)}?cursor=${encodeURIComponent(cursor)}&limit=100`;
      const data = await PekoraAPI._fetchJSON(url);
      if (!data) break;
      const items = data.data || [];
      all.push(...items);
      const next = data.nextPageCursor;
      if (!next || items.length === 0) break;
      cursor = next;
    }
    return all;
  }

  /**
   * Tear down any rows we previously injected and un-hide the native ones.
   * Used between type-select changes and on initial mount.
   */
  function clearInjected(tbody) {
    tbody.querySelectorAll(".tm-injected, .tm-loading-row").forEach(el => el.remove());
    tbody.querySelectorAll("tr").forEach(el => {
      // Only undo the display:none we set ourselves; don't touch rows that
      // Pekora has hidden for its own reasons.
      if (el.style.display === "none") el.style.display = "";
    });
  }

  function buildTradeRow(trade) {
    const tr = document.createElement("tr");
    tr.className = "tm-injected";
    tr._tmTrade = trade;

    function tdBasic(text) {
      const td = document.createElement("td");
      td.className = "tm-td";
      td.textContent = text;
      return td;
    }

    tr.appendChild(tdBasic(formatDate(trade.created)));
    tr.appendChild(tdBasic(formatDate(trade.expiration)));

    // Partner column with avatar headshot
    const tdPartner = document.createElement("td");
    tdPartner.className = "tm-td";
    const partnerWrap = document.createElement("div");
    partnerWrap.className = "tm-partner-cell";
    const img = document.createElement("img");
    const partner = trade.user ? (trade.user.displayName || trade.user.name || "Unknown") : "Unknown";
    img.alt = partner;
    img.loading = "lazy";
    if (trade.user && trade.user.id) {
      fetchAvatar(trade.user.id).then(url => { if (url) img.src = url; });
    }
    const nameP = document.createElement("p");
    nameP.className = "tm-partner-name";
    nameP.textContent = partner;
    partnerWrap.appendChild(img);
    partnerWrap.appendChild(nameP);
    tdPartner.appendChild(partnerWrap);
    tr.appendChild(tdPartner);

    tr.appendChild(tdBasic(trade.status || "—"));

    const tdAction = document.createElement("td");
    tdAction.className = "tm-td";
    const btn = document.createElement("button");
    btn.className = "tm-view-btn";
    btn.textContent = "View Details";
    tdAction.appendChild(btn);
    tr.appendChild(tdAction);

    return tr;
  }

  // ============================================================
  // CUSTOM MODAL
  // ============================================================

  async function openModal(trade) {
    document.querySelector(".tm-modal-bg")?.remove();

    const tradeStatus = (trade.status || "").toLowerCase();
    const tradeType = (trade.tradeType || "").toLowerCase();
    const isInbound = tradeType === "inbound" || tradeStatus === "open" || tradeStatus === "countered";

    // ----- Build modal skeleton -----
    const bg = document.createElement("div");
    bg.className = "tm-modal-bg";

    const modal = document.createElement("div");
    modal.className = "tm-modal";

    const titleEl = document.createElement("div");
    titleEl.className = "tm-modal-title";
    titleEl.textContent = "Trade Request";
    modal.appendChild(titleEl);

    const closeEl = document.createElement("div");
    closeEl.className = "tm-modal-close";
    closeEl.textContent = "✕";
    modal.appendChild(closeEl);

    const body = document.createElement("div");
    body.className = "tm-modal-body";

    const sidebar = document.createElement("div");
    sidebar.className = "tm-sidebar";
    sidebar.innerHTML = `<div class="tm-sidebar-loading">Loading…</div>`;

    const content = document.createElement("div");
    content.className = "tm-content";
    content.innerHTML = `<div class="tm-content-loading">Loading trade details…</div>`;

    body.appendChild(sidebar);
    body.appendChild(content);
    modal.appendChild(body);

    // ----- Footer (action buttons depend on whether this is inbound) -----
    const footer = document.createElement("div");
    footer.className = "tm-modal-footer";

    if (isInbound) {
      const acceptBtn = mkBtn("Accept", "tm-btn-accept");
      const counterBtn = mkBtn("Counter", "tm-btn-counter");
      const declineBtn = mkBtn("Decline", "tm-btn-decline");
      const allBtns = [acceptBtn, counterBtn, declineBtn];
      const disableAll = () => allBtns.forEach(b => { b.disabled = true; });
      const reEnableAll = () => allBtns.forEach(b => { b.disabled = false; });

      acceptBtn.addEventListener("click", () => {
        disableAll();
        acceptBtn.textContent = "…";
        tradeAction(trade.id, "accept")
          .then(() => {
            acceptBtn.textContent = "✓ Accepted";
            setTimeout(() => { bg.remove(); location.reload(); }, 900);
          })
          .catch(err => {
            reEnableAll();
            acceptBtn.textContent = "Accept";
            alert("Accept failed: " + err.message);
          });
      });

      declineBtn.addEventListener("click", () => {
        disableAll();
        declineBtn.textContent = "…";
        tradeAction(trade.id, "decline")
          .then(() => {
            declineBtn.textContent = "✓ Declined";
            setTimeout(() => { bg.remove(); location.reload(); }, 900);
          })
          .catch(err => {
            reEnableAll();
            declineBtn.textContent = "Decline";
            alert("Decline failed: " + err.message);
          });
      });

      // Counter just opens Pekora's native trade-window page in a popup -
      // building a counter-trade UI from scratch is out of scope here.
      counterBtn.addEventListener("click", () => {
        const pid = trade.user ? trade.user.id : "";
        const url = `${BASE}/Trade/TradeWindow.aspx?TradeSessionId=${trade.id}&TradePartnerID=${pid}`;
        window.open(url, "_blank", "popup,width=900,height=700,scrollbars=yes,resizable=yes");
      });

      footer.appendChild(acceptBtn);
      footer.appendChild(counterBtn);
      footer.appendChild(declineBtn);
    } else {
      const okBtn = mkBtn("OK", "tm-btn-ok");
      okBtn.addEventListener("click", () => bg.remove());
      footer.appendChild(okBtn);
    }
    modal.appendChild(footer);

    bg.appendChild(modal);
    document.body.appendChild(bg);

    // ----- Close handlers -----
    const closeModal = () => bg.remove();
    closeEl.addEventListener("click", closeModal);
    bg.addEventListener("click", e => { if (e.target === bg) closeModal(); });
    const onKey = (e) => {
      if (e.key === "Escape") {
        closeModal();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);

    // ----- Fetch full detail and render -----
    try {
      const detail = await PekoraAPI.getTradeDetail(trade.id);
      if (!detail) throw new Error("Could not fetch trade detail");

      const { myOffer, theirOffer } = PekoraAPI.splitTradeOffers(detail, myUserId);
      const myAssets = (myOffer && myOffer.userAssets) || [];
      const theirAssets = (theirOffer && theirOffer.userAssets) || [];
      const partner = (theirOffer && theirOffer.user) || trade.user || {};
      const partnerName = partner.displayName || partner.name || "Unknown";
      const partnerId = partner.id;

      const myCalc = PekoraAPI.calculateOfferValue(myAssets);
      const theirCalc = PekoraAPI.calculateOfferValue(theirAssets);

      // The score field falls back to RAP when Koromons doesn't know an item,
      // so it's the right number for "effective value" / win-loss diff.
      const myValue = myCalc.totalValue;
      const theirValue = theirCalc.totalValue;
      const myRap = myCalc.totalRap;
      const theirRap = theirCalc.totalRap;
      // Pekora's offer object exposes robux as either `robuxAmount` or `robux`
      // depending on the endpoint. Read both to be safe.
      const myRobux = (myOffer && (myOffer.robuxAmount || myOffer.robux)) || 0;
      const theirRobux = (theirOffer && (theirOffer.robuxAmount || theirOffer.robux)) || 0;

      const valDiff = theirValue - myValue;

      // Fetch avatar + asset thumbs in parallel - both block the final paint
      // anyway, so we want them done at the same time.
      const allAssetIds = [...myAssets, ...theirAssets].map(a => a.assetId).filter(Boolean);
      const [avatarUrl, thumbMap] = await Promise.all([
        partnerId ? fetchAvatar(partnerId) : Promise.resolve(""),
        fetchAssetThumbnails(allAssetIds)
      ]);

      // ----- Render sidebar + content -----
      renderSidebar(sidebar, {
        avatarUrl, partnerName, partnerId, isInbound,
        tradeStatus: detail.status,
        valDiff,
        myValue, myRap, myRobux,
        theirValue, theirRap, theirRobux
      });

      content.innerHTML = "";
      content.appendChild(renderSection("Items you will give", myCalc.items, myAssets, thumbMap, myValue, myRap, myRobux));

      const hr = document.createElement("hr");
      hr.className = "tm-divider";
      content.appendChild(hr);

      content.appendChild(renderSection("Items you will receive", theirCalc.items, theirAssets, thumbMap, theirValue, theirRap, theirRobux));

    } catch (e) {
      sidebar.innerHTML = "";
      content.innerHTML = `<div class="tm-error">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  function mkBtn(text, cls) {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = text;
    return b;
  }

  function renderSidebar(sidebar, opts) {
    sidebar.innerHTML = "";

    const av = document.createElement("img");
    av.className = "tm-avatar";
    av.alt = opts.partnerName;
    if (opts.avatarUrl) av.src = opts.avatarUrl;
    sidebar.appendChild(av);

    const status = document.createElement("div");
    status.className = "tm-trade-status";
    const partnerLink = document.createElement("a");
    partnerLink.className = "tm-partner-link";
    partnerLink.href = `/users/${opts.partnerId || ""}/profile`;
    partnerLink.textContent = opts.partnerName;
    status.appendChild(partnerLink);
    status.appendChild(document.createTextNode(
      opts.isInbound
        ? " sent you a trade!"
        : ` — trade ${opts.tradeStatus || ""}`
    ));
    sidebar.appendChild(status);

    // Big colored value-diff headline (RoPro-style)
    const diffCls = opts.valDiff > 0 ? "pos" : opts.valDiff < 0 ? "neg" : "neu";
    const diffStr = (opts.valDiff >= 0 ? "+" : "") + opts.valDiff.toLocaleString();
    const diffEl = document.createElement("div");
    diffEl.className = `tm-diff ${diffCls}`;
    diffEl.textContent = `${diffStr} Value`;
    sidebar.appendChild(diffEl);

    sidebar.appendChild(sideLbl("You're offering:"));
    sidebar.appendChild(sideValRow("kol", opts.myValue));
    sidebar.appendChild(sideValRow("rap", opts.myRap));
    if (opts.myRobux) sidebar.appendChild(sideValRow("robux", opts.myRobux));

    sidebar.appendChild(sideLbl("They're offering:"));
    sidebar.appendChild(sideValRow("kol", opts.theirValue));
    sidebar.appendChild(sideValRow("rap", opts.theirRap));
    if (opts.theirRobux) sidebar.appendChild(sideValRow("robux", opts.theirRobux));
  }

  function sideLbl(text) {
    const d = document.createElement("div");
    d.className = "tm-sidebar-lbl";
    d.textContent = text;
    return d;
  }

  function sideValRow(type, val) {
    const row = document.createElement("div");
    row.className = `tm-sidebar-valrow ${type}`;
    row.appendChild(valIcon(type));
    const sp = document.createElement("span");
    sp.textContent = val.toLocaleString();
    row.appendChild(sp);
    return row;
  }

  /**
   * The three coin-style value icons used throughout the modal:
   *   - "kol":   amber K (Koromons community value)
   *   - "rap":   green R$ (recent average price)
   *   - "robux": green R$ (raw robux in the trade) - same color as RAP since
   *              they're both denominated in robux semantically.
   */
  function valIcon(type) {
    const ic = document.createElement("span");
    ic.className = `tm-val-icon ${type}`;
    ic.textContent = type === "kol" ? "K" : "R$";
    ic.setAttribute("aria-hidden", "true");
    return ic;
  }

  function renderSection(label, calcItems, rawAssets, thumbMap, kolTotal, rapTotal, robuxAmt) {
    const sec = document.createElement("div");
    sec.className = "tm-section";

    const lbl = document.createElement("div");
    lbl.className = "tm-section-label";
    lbl.textContent = label;
    sec.appendChild(lbl);

    const grid = document.createElement("div");
    grid.className = "tm-item-grid";

    // Render up to 5 slots (Pekora's native UI cap). If a side is empty,
    // we still want the grid to take space so the layout is balanced.
    const count = Math.min(rawAssets.length, 5);
    if (count === 0) {
      const empty = document.createElement("div");
      empty.className = "tm-slot-empty-msg";
      empty.textContent = "Nothing offered";
      grid.appendChild(empty);
    } else {
      for (let i = 0; i < count; i++) {
        grid.appendChild(buildSlot(rawAssets[i], calcItems[i], thumbMap));
      }
    }

    sec.appendChild(grid);

    // Per-section totals (Korone Value + RAP)
    const tot = document.createElement("div");
    tot.className = "tm-section-total";
    const totLbl = document.createElement("span");
    totLbl.className = "tm-section-total-label";
    totLbl.textContent = "Total Value:";
    const totVals = document.createElement("div");
    totVals.className = "tm-section-total-vals";

    const tKol = document.createElement("div");
    tKol.className = "tm-section-total-kol";
    tKol.appendChild(valIcon("kol"));
    const tKolN = document.createElement("span");
    tKolN.textContent = kolTotal.toLocaleString();
    tKol.appendChild(tKolN);

    const tRap = document.createElement("div");
    tRap.className = "tm-section-total-rap";
    tRap.appendChild(valIcon("rap"));
    const tRapN = document.createElement("span");
    tRapN.textContent = rapTotal.toLocaleString();
    tRap.appendChild(tRapN);

    totVals.appendChild(tKol);
    totVals.appendChild(tRap);
    tot.appendChild(totLbl);
    tot.appendChild(totVals);
    sec.appendChild(tot);

    if (robuxAmt) {
      const robuxRow = document.createElement("div");
      robuxRow.className = "tm-section-robux";
      const lbl2 = document.createElement("span");
      lbl2.textContent = "Robux Offered:";
      const right = document.createElement("div");
      right.appendChild(valIcon("robux"));
      const n = document.createElement("span");
      n.textContent = robuxAmt.toLocaleString();
      right.appendChild(n);
      robuxRow.appendChild(lbl2);
      robuxRow.appendChild(right);
      sec.appendChild(robuxRow);
    }

    return sec;
  }

  function buildSlot(rawAsset, calcItem, thumbMap) {
    const slot = document.createElement("div");
    slot.className = "tm-slot";

    const imgWrap = document.createElement("div");
    imgWrap.className = "tm-slot-img-wrap";
    const img = document.createElement("img");
    img.alt = rawAsset.name || "";
    img.loading = "lazy";
    const thumb = thumbMap[rawAsset.assetId];
    if (thumb) img.src = absUrl(thumb);
    imgWrap.appendChild(img);

    // Serial overlay (limited / unique) takes priority; otherwise show UAID.
    if (rawAsset.serialNumber) {
      const serial = document.createElement("span");
      serial.className = "tm-slot-serial";
      serial.textContent = "#" + rawAsset.serialNumber;
      imgWrap.appendChild(serial);
    } else if (rawAsset.id || rawAsset.userAssetId) {
      const uaid = document.createElement("span");
      uaid.className = "tm-slot-uaid";
      uaid.textContent = "UAID: " + (rawAsset.id || rawAsset.userAssetId);
      imgWrap.appendChild(uaid);
    }
    slot.appendChild(imgWrap);

    // Item name links to the catalog page so the user can click through.
    const slug = (rawAsset.name || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const nameDiv = document.createElement("div");
    nameDiv.className = "tm-slot-name";
    const nameA = document.createElement("a");
    nameA.href = `/catalog/${rawAsset.assetId}/${slug}`;
    nameA.textContent = rawAsset.name || "?";
    nameA.title = rawAsset.name || "";
    nameDiv.appendChild(nameA);
    slot.appendChild(nameDiv);

    // Korone Value (falls back to RAP if no community value is known) +
    // raw RAP. Both rows always render so columns line up across slots.
    const kolValue = (calcItem && calcItem.hasKoromonValue) ? calcItem.koromonValue : 0;
    const rap = rawAsset.recentAveragePrice || 0;

    const kolRow = document.createElement("div");
    kolRow.className = "tm-slot-val-row kol";
    kolRow.appendChild(valIcon("kol"));
    const kolN = document.createElement("span");
    kolN.textContent = (kolValue || rap).toLocaleString();
    kolRow.appendChild(kolN);
    slot.appendChild(kolRow);

    const rapRow = document.createElement("div");
    rapRow.className = "tm-slot-val-row rap";
    rapRow.appendChild(valIcon("rap"));
    const rapN = document.createElement("span");
    rapN.textContent = rap.toLocaleString();
    rapRow.appendChild(rapN);
    slot.appendChild(rapRow);

    return slot;
  }

  // ============================================================
  // API HELPERS (CSRF-aware POST + thumbnails)
  // ============================================================

  function getCsrfFromCookie() {
    const m = document.cookie.match(/rbxcsrf4=([^;]+)/);
    return m ? m[1] : "";
  }

  /**
   * POST against Pekora's API, automatically refreshing the CSRF token from
   * the 403 response header and retrying once. Mirrors what Pekora's own
   * Roblox-derived clients do.
   */
  async function tApiPost(url) {
    if (!csrfToken) csrfToken = getCsrfFromCookie();

    const tryPost = async (token) => {
      const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json"
      };
      if (token) headers["x-csrf-token"] = token;
      return fetch(url, {
        method: "POST",
        credentials: "include",
        headers,
        body: "{}"
      });
    };

    let resp = await tryPost(csrfToken);
    if (resp.status === 403) {
      const newToken = resp.headers.get("x-csrf-token");
      if (newToken && newToken !== csrfToken) {
        csrfToken = newToken;
        resp = await tryPost(csrfToken);
      }
    }
    if (!resp.ok) {
      // Try to surface Pekora's structured error message instead of "HTTP 400".
      let msg = "HTTP " + resp.status;
      try {
        const j = await resp.json();
        if (j.errors && j.errors[0] && j.errors[0].message) msg = j.errors[0].message;
      } catch {}
      throw new Error(msg);
    }
    return resp;
  }

  function tradeAction(tradeId, action) {
    return tApiPost(`${TRADE_API}/${tradeId}/${action}`);
  }

  async function fetchAvatar(userId) {
    try {
      const r = await fetch(
        `${THUMB_API}/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`,
        { credentials: "include" }
      );
      if (!r.ok) return "";
      const j = await r.json();
      const url = j.data?.[0]?.imageUrl;
      return url ? absUrl(url) : "";
    } catch { return ""; }
  }

  /**
   * Batch-fetch asset thumbnails. Pekora's endpoint accepts a comma-separated
   * list of asset IDs, so we get every item in one round-trip.
   */
  async function fetchAssetThumbnails(assetIds) {
    if (!assetIds.length) return {};
    try {
      const r = await fetch(
        `${THUMB_API}/assets?assetIds=${assetIds.join(",")}&size=110x110&format=Png`,
        { credentials: "include" }
      );
      if (!r.ok) return {};
      const j = await r.json();
      const map = {};
      for (const item of (j.data || [])) {
        if (item.imageUrl) map[item.targetId] = item.imageUrl;
      }
      return map;
    } catch { return {}; }
  }

  // ============================================================
  // FORMATTING HELPERS
  // ============================================================

  function formatDate(s) {
    if (!s) return "—";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "—";
    return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function absUrl(url) {
    if (!url) return "";
    return url.startsWith("http") ? url : BASE + url;
  }
})();
