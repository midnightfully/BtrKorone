/**
 * BtrKorone - Popup Script
 * Handles UI rendering, feature toggles, premium verification, avatar display
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

  // Version
  document.getElementById("version").textContent = s.version;

  // Avatar
  renderAvatar(s.avatarUrl);

  // Header username
  const usernameEl = document.getElementById("header-username");
  usernameEl.textContent = s.username || "";

  // Tier badge
  const tierBadge = document.getElementById("tier-badge");
  tierBadge.textContent = s.tierInfo.label;
  tierBadge.className = "tier-badge " + s.tierInfo.cssClass;

  // Avatar ring color
  const ring = document.getElementById("avatar-tier-ring");
  ring.style.borderColor = s.tierInfo.color;

  // Master toggle
  document.getElementById("master-toggle").checked = s.settings.enabled;

  // Status tab
  document.getElementById("status-account").textContent =
    s.username ? `${s.username} (ID: ${s.userId})` : "Not linked";
  document.getElementById("status-tier").textContent = s.tierInfo.label;
  document.getElementById("status-tier").style.color = s.tierInfo.color;
  document.getElementById("status-verified").textContent =
    s.lastVerified ? formatTimeAgo(s.lastVerified) : "Never";

  // Show/hide buttons
  if (s.userId) {
    document.getElementById("btn-recheck").style.display = "block";
    document.getElementById("btn-logout").style.display = "block";
    document.getElementById("input-userid").value = s.userId;
  }

  // Render feature toggles
  renderFeatureToggles();

  // Render feature pills summary
  renderFeaturePills();
}

// === Avatar ===

function renderAvatar(url) {
  const img = document.getElementById("avatar-img");
  if (url) {
    img.src = url;
    img.classList.add("loaded");
  } else {
    img.src = "../icons/icon32.png";
    img.classList.remove("loaded");
  }
}

// === Feature Toggles UI ===

function renderFeatureToggles() {
  const container = document.getElementById("features-list");
  container.innerHTML = "";

  const tier = currentStatus.tier;
  const categories = {};

  // Group features by category
  BTRKORONE.FEATURE_REGISTRY.forEach(feature => {
    const cat = feature.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(feature);
  });

  // Render each category
  Object.entries(categories).forEach(([catKey, features]) => {
    const catInfo = BTRKORONE.FEATURE_CATEGORIES[catKey] || { label: catKey };

    const group = document.createElement("div");
    group.className = "feature-group";

    const header = document.createElement("h3");
    header.className = "feature-group-header";
    header.textContent = catInfo.label;
    group.appendChild(header);

    features.forEach(feature => {
      const state = featureState[feature.id];
      const accessible = tier >= feature.tier;
      const enabled = state ? state.enabled : feature.defaultEnabled;

      const row = document.createElement("label");
      row.className = "feature-row" + (accessible ? "" : " locked");

      const info = document.createElement("div");
      info.className = "feature-info";

      const nameRow = document.createElement("div");
      nameRow.className = "feature-name-row";

      const name = document.createElement("span");
      name.className = "feature-name";
      name.textContent = feature.name;
      nameRow.appendChild(name);

      // Tier badge
      if (feature.tier > 0) {
        const badge = document.createElement("span");
        badge.className = "feature-tier-badge " + (feature.tier === 1 ? "badge-plus" : "badge-rex");
        badge.textContent = feature.tier === 1 ? "+" : "REX";
        nameRow.appendChild(badge);
      }

      info.appendChild(nameRow);

      const desc = document.createElement("span");
      desc.className = "feature-desc";
      desc.textContent = feature.description;
      info.appendChild(desc);

      row.appendChild(info);

      // Toggle switch
      const toggle = document.createElement("div");
      toggle.className = "feature-toggle-wrap";

      if (accessible) {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = enabled;
        input.dataset.featureId = feature.id;
        input.addEventListener("change", handleFeatureToggle);

        const slider = document.createElement("span");
        slider.className = "mini-toggle-slider";

        const label = document.createElement("label");
        label.className = "mini-toggle";
        label.appendChild(input);
        label.appendChild(slider);
        toggle.appendChild(label);
      } else {
        const lockIcon = document.createElement("span");
        lockIcon.className = "lock-icon";
        lockIcon.textContent = "\uD83D\uDD12";
        lockIcon.title = `Requires ${feature.tier === 1 ? "BtrKorone+" : "BtrKorone Rex"}`;
        toggle.appendChild(lockIcon);
      }

      row.appendChild(toggle);
      group.appendChild(row);
    });

    container.appendChild(group);
  });
}

async function handleFeatureToggle(e) {
  const featureId = e.target.dataset.featureId;
  const enabled = e.target.checked;
  await sendMessage({ type: "TOGGLE_FEATURE", featureId, enabled });
  // Update local state
  if (featureState[featureId]) {
    featureState[featureId].enabled = enabled;
    featureState[featureId].active = enabled;
  }
  renderFeaturePills();
}

// === Feature Pills Summary ===

function renderFeaturePills() {
  const container = document.getElementById("feature-pills");
  container.innerHTML = "";

  const tier = currentStatus.tier;
  let activeCount = 0;

  BTRKORONE.FEATURE_REGISTRY.forEach(feature => {
    const accessible = tier >= feature.tier;
    const state = featureState[feature.id];
    const enabled = state ? state.enabled : feature.defaultEnabled;
    if (accessible && enabled) activeCount++;
  });

  const total = BTRKORONE.FEATURE_REGISTRY.filter(f => tier >= f.tier).length;

  const pill = document.createElement("span");
  pill.className = "feature-pill";
  pill.textContent = `${activeCount}/${total} enabled`;
  container.appendChild(pill);

  if (tier < 2) {
    const upgradePill = document.createElement("span");
    upgradePill.className = "feature-pill upgrade-pill";
    const locked = BTRKORONE.FEATURE_REGISTRY.filter(f => f.tier > tier).length;
    upgradePill.textContent = `${locked} locked`;
    container.appendChild(upgradePill);
  }
}

// === Master Toggle ===

function setupMasterToggle() {
  document.getElementById("master-toggle").addEventListener("change", async (e) => {
    await sendMessage({ type: "UPDATE_SETTINGS", settings: { enabled: e.target.checked } });
  });
}

// === Tab Navigation ===

function setupTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

// === Premium Verification ===

function setupVerification() {
  const btnGenerate = document.getElementById("btn-generate-token");
  const btnVerify = document.getElementById("btn-verify");
  const btnCopy = document.getElementById("btn-copy-token");
  const btnLogout = document.getElementById("btn-logout");
  const btnRecheck = document.getElementById("btn-recheck");

  btnGenerate.addEventListener("click", async () => {
    const userId = document.getElementById("input-userid").value.trim();
    if (!userId || isNaN(userId)) {
      showMessage("Please enter a valid numeric Roblox User ID.", "error");
      return;
    }

    btnGenerate.textContent = "Generating...";
    btnGenerate.disabled = true;

    const result = await sendMessage({ type: "GENERATE_TOKEN", userId });

    btnGenerate.textContent = "Generate Verification Token";
    btnGenerate.disabled = false;

    if (result.error) {
      showMessage(result.error, "error");
      return;
    }

    // Update avatar if fetched
    if (result.avatarUrl) renderAvatar(result.avatarUrl);
    if (result.username) {
      document.getElementById("header-username").textContent = result.username;
    }

    // Show token
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

    if (!userId || !token) {
      showMessage("Please generate a token first.", "error");
      return;
    }

    btnVerify.textContent = "Verifying...";
    btnVerify.disabled = true;

    const result = await sendMessage({ type: "VERIFY_PREMIUM", userId, token });

    btnVerify.textContent = "Verify Ownership";
    btnVerify.disabled = false;

    if (result.success) {
      showMessage(result.message, "success");
      await loadFullState(); // Full UI refresh
    } else {
      showMessage(result.message || result.error, "error");
    }
  });

  btnLogout.addEventListener("click", async () => {
    if (confirm("This will unlink your account and remove premium access. Continue?")) {
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

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || null);
    });
  });
}

function showMessage(text, type) {
  const el = document.getElementById("verification-message");
  el.textContent = text;
  el.className = `message ${type}`;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 10000);
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
