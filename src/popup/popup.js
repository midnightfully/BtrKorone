/**
 * BtrKorone - Popup Script (DaisyUI version)
 * Handles UI, feature toggles, premium verification
 */

let currentStatus = null;
let featureState = null;

document.addEventListener("DOMContentLoaded", async () => {
  await loadFullState();
  setupTabs();
  setupVerification();
  setupMasterToggle();
});

// === State Loading ===

async function loadFullState() {
  currentStatus = await sendMessage({ type: "GET_STATUS" });
  featureState = await sendMessage({ type: "GET_FEATURE_STATE" });
  if (currentStatus) renderUI();
}

function renderUI() {
  const s = currentStatus;

  document.getElementById("version").textContent = s.version;

  // Avatar - use Pekora headshot URL directly
  const img = document.getElementById("avatar-img");
  if (s.avatarUrl) {
    img.src = s.avatarUrl;
  } else if (s.userId) {
    img.src = `https://www.pekora.zip/headshot-thumbnail/image?userId=${s.userId}&width=150&height=150&format=png`;
  }

  // Username
  document.getElementById("header-username").textContent = s.username || "";

  // Tier badge
  const badge = document.getElementById("tier-badge");
  badge.textContent = s.tierInfo.label;
  badge.className = "badge badge-sm " + s.tierInfo.cssClass;

  // Master toggle
  document.getElementById("master-toggle").checked = s.settings.enabled;

  // Status
  document.getElementById("status-account").textContent =
    s.username ? `${s.username} (ID: ${s.userId})` : "Not linked";
  document.getElementById("status-tier").textContent = s.tierInfo.label;
  document.getElementById("status-verified").textContent =
    s.lastVerified ? formatTimeAgo(s.lastVerified) : "Never";

  if (s.userId) {
    document.getElementById("btn-recheck").style.display = "block";
    document.getElementById("btn-logout").style.display = "block";
    document.getElementById("input-userid").value = s.userId;
  }

  renderFeatureToggles();
  renderFeaturePills();
}

// === Tabs ===

function setupTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("tab-active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("tab-active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    });
  });
}

// === Feature Toggles ===

function renderFeatureToggles() {
  const container = document.getElementById("features-list");
  container.innerHTML = "";
  const tier = currentStatus.tier;
  const categories = {};

  BTRKORONE.FEATURE_REGISTRY.forEach(f => {
    if (!categories[f.category]) categories[f.category] = [];
    categories[f.category].push(f);
  });

  Object.entries(categories).forEach(([catKey, features]) => {
    const catInfo = BTRKORONE.FEATURE_CATEGORIES[catKey] || { label: catKey };
    const group = document.createElement("div");
    group.className = "feature-group";

    const header = document.createElement("div");
    header.className = "feature-group-header";
    header.textContent = catInfo.label;
    group.appendChild(header);

    features.forEach(feature => {
      const state = featureState ? featureState[feature.id] : null;
      const accessible = tier >= feature.tier;
      const enabled = state ? state.enabled : feature.defaultEnabled;

      const row = document.createElement("div");
      row.className = "feature-row" + (accessible ? "" : " locked");

      const info = document.createElement("div");
      info.className = "feature-info";

      const nameEl = document.createElement("div");
      nameEl.className = "feature-name";
      nameEl.textContent = feature.name;

      if (feature.tier > 0) {
        const badge = document.createElement("span");
        badge.className = "badge badge-xs " + (feature.tier === 1 ? "badge-info" : "badge-warning");
        badge.textContent = feature.tier === 1 ? "+" : "REX";
        nameEl.appendChild(badge);
      }

      info.appendChild(nameEl);

      const desc = document.createElement("span");
      desc.className = "feature-desc";
      desc.textContent = feature.description;
      info.appendChild(desc);

      row.appendChild(info);

      const toggleWrap = document.createElement("div");
      toggleWrap.className = "feature-toggle-wrap";

      if (accessible) {
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.className = "toggle toggle-xs toggle-primary";
        toggle.checked = enabled;
        toggle.dataset.featureId = feature.id;
        toggle.addEventListener("change", handleFeatureToggle);
        toggleWrap.appendChild(toggle);
      } else {
        const lock = document.createElement("span");
        lock.className = "lock-icon";
        lock.textContent = "\uD83D\uDD12";
        toggleWrap.appendChild(lock);
      }

      row.appendChild(toggleWrap);
      group.appendChild(row);
    });

    container.appendChild(group);
  });
}

async function handleFeatureToggle(e) {
  const featureId = e.target.dataset.featureId;
  const enabled = e.target.checked;
  await sendMessage({ type: "TOGGLE_FEATURE", featureId, enabled });
  if (featureState && featureState[featureId]) {
    featureState[featureId].enabled = enabled;
  }
  renderFeaturePills();
}

// === Feature Pills ===

function renderFeaturePills() {
  const container = document.getElementById("feature-pills");
  container.innerHTML = "";
  const tier = currentStatus.tier;
  let active = 0;
  const total = BTRKORONE.FEATURE_REGISTRY.filter(f => tier >= f.tier).length;

  BTRKORONE.FEATURE_REGISTRY.forEach(f => {
    if (tier >= f.tier) {
      const state = featureState ? featureState[f.id] : null;
      if (state ? state.enabled : f.defaultEnabled) active++;
    }
  });

  const pill = document.createElement("span");
  pill.className = "badge badge-sm badge-primary badge-outline";
  pill.textContent = `${active}/${total} enabled`;
  container.appendChild(pill);

  if (tier < 2) {
    const locked = BTRKORONE.FEATURE_REGISTRY.filter(f => f.tier > tier).length;
    const lockPill = document.createElement("span");
    lockPill.className = "badge badge-sm badge-warning badge-outline";
    lockPill.textContent = `${locked} locked`;
    container.appendChild(lockPill);
  }
}

// === Master Toggle ===

function setupMasterToggle() {
  document.getElementById("master-toggle").addEventListener("change", async (e) => {
    await sendMessage({ type: "UPDATE_SETTINGS", settings: { enabled: e.target.checked } });
  });
}

// === Verification ===

function setupVerification() {
  const btnGenerate = document.getElementById("btn-generate-token");
  const btnVerify = document.getElementById("btn-verify");
  const btnCopy = document.getElementById("btn-copy-token");
  const btnLogout = document.getElementById("btn-logout");
  const btnRecheck = document.getElementById("btn-recheck");

  btnGenerate.addEventListener("click", async () => {
    const userId = document.getElementById("input-userid").value.trim();
    if (!userId || isNaN(userId)) {
      showMessage("Enter a valid Korone User ID (number from your profile URL).", "error");
      return;
    }

    btnGenerate.textContent = "Generating...";
    btnGenerate.disabled = true;
    const result = await sendMessage({ type: "GENERATE_TOKEN", userId });
    btnGenerate.textContent = "Generate Verification Token";
    btnGenerate.disabled = false;

    if (result.error) { showMessage(result.error, "error"); return; }

    // Update avatar
    const img = document.getElementById("avatar-img");
    img.src = `https://www.pekora.zip/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`;

    if (result.username) document.getElementById("header-username").textContent = result.username;

    document.getElementById("token-display").style.display = "block";
    document.getElementById("token-value").textContent = result.token;
    document.getElementById("btn-verify").style.display = "block";
    showMessage("Token generated! Paste it in your Korone About Me, then click Verify.", "info");
  });

  btnCopy.addEventListener("click", () => {
    const token = document.getElementById("token-value").textContent;
    navigator.clipboard.writeText(token).then(() => {
      btnCopy.textContent = "Copied!";
      setTimeout(() => { btnCopy.textContent = "Copy"; }, 2000);
    });
  });

  btnVerify.addEventListener("click", async () => {
    const userId = document.getElementById("input-userid").value.trim();
    const token = document.getElementById("token-value").textContent;
    if (!userId || !token) { showMessage("Generate a token first.", "error"); return; }

    btnVerify.textContent = "Verifying...";
    btnVerify.disabled = true;
    const result = await sendMessage({ type: "VERIFY_PREMIUM", userId, token });
    btnVerify.textContent = "Verify Ownership";
    btnVerify.disabled = false;

    if (result.success) {
      showMessage(result.message, "success");
      await loadFullState();
    } else {
      showMessage(result.message || result.error, "error");
    }
  });

  btnLogout.addEventListener("click", async () => {
    if (confirm("Unlink account and remove premium access?")) {
      await sendMessage({ type: "LOGOUT" });
      showMessage("Account unlinked.", "info");
      await loadFullState();
    }
  });

  btnRecheck.addEventListener("click", async () => {
    btnRecheck.textContent = "Checking...";
    btnRecheck.disabled = true;
    await sendMessage({ type: "FORCE_RECHECK" });
    btnRecheck.textContent = "Re-check Subscription";
    btnRecheck.disabled = false;
    await loadFullState();
  });
}

// === Helpers ===

function sendMessage(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, r => resolve(r || null)));
}

function showMessage(text, type) {
  const el = document.getElementById("verification-message");
  el.textContent = text;
  el.className = `alert alert-sm mt-2 alert-${type}`;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 10000);
}

function formatTimeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
