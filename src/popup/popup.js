/**
 * BtrKorone - Popup Script (RoPro-inspired layout)
 */

let currentStatus = null;
let featureState = null;

// Tier metadata for the bottom tabs
const TIER_TABS = {
  free: { id: 0, label: "BtrKorone Free", containerId: "free-features", heading: "General Features" },
  plus: { id: 1, label: "BtrKorone Plus", containerId: "plus-features", heading: "Plus Features" },
  rex:  { id: 2, label: "BtrKorone Rex",  containerId: "rex-features",  heading: "Rex Features" }
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadFullState();
  setupTabs();
  setupActions();
  setupModal();
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

  // User avatar (left card)
  const userAvatar = document.getElementById("user-avatar");
  if (s.avatarUrl) userAvatar.src = s.avatarUrl;
  else if (s.userId) userAvatar.src = `https://www.pekora.zip/headshot-thumbnail/image?userId=${s.userId}&width=150&height=150&format=png`;

  // Username
  document.getElementById("user-name").textContent = s.username || "Not linked";

  // Tier label + tier-specific avatar icon
  document.getElementById("tier-label").textContent = s.tierInfo.label;
  const tierAvatar = document.getElementById("tier-avatar");
  if (s.tier === 2) tierAvatar.src = "../icons/tier-rex.png";
  else if (s.tier === 1) tierAvatar.src = "../icons/tier-plus.png";
  else tierAvatar.src = "../icons/tier-free.png";

  // Render features for all 3 tier panels
  renderTierFeatures("free", 0);
  renderTierFeatures("plus", 1);
  renderTierFeatures("rex", 2);

  // Show/hide upgrade prompts based on the user's tier
  renderUpgradePrompts(s.tier);
}

// === Upgrade Prompts (shown in the Plus / Rex tabs) ===

function renderUpgradePrompts(userTier) {
  const plusBtn = document.getElementById("upgrade-plus-btn");
  const rexBtn  = document.getElementById("upgrade-rex-btn");

  if (plusBtn) plusBtn.style.display = userTier < BTRKORONE.TIERS.PLUS.id ? "flex" : "none";
  if (rexBtn)  rexBtn.style.display  = userTier < BTRKORONE.TIERS.REX.id  ? "flex" : "none";
}

// === Tier Tabs ===

function setupTabs() {
  document.querySelectorAll(".tier-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tier-tab").forEach(t => t.classList.remove("tier-tab-active"));
      document.querySelectorAll(".tier-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("tier-tab-active");
      document.getElementById(`tier-${tab.dataset.tierTab}`).classList.add("active");
    });
  });
}

// === Render features for a specific tier panel ===

function renderTierFeatures(tabKey, requiredTier) {
  const container = document.getElementById(TIER_TABS[tabKey].containerId);
  if (!container) return;
  container.innerHTML = "";

  const userTier = currentStatus.tier;
  const features = BTRKORONE.FEATURE_REGISTRY.filter(f => f.tier === requiredTier);

  features.forEach(feature => {
    const accessible = userTier >= feature.tier;
    const state = featureState ? featureState[feature.id] : null;
    const enabled = state ? state.enabled : feature.defaultEnabled;

    const row = document.createElement("div");
    row.className = "feature-row" + (accessible ? "" : " locked");

    // Left: feature info
    const info = document.createElement("div");
    info.className = "feature-info";

    const name = document.createElement("span");
    name.className = "feature-name";
    name.textContent = feature.name;
    info.appendChild(name);

    // Info icon (tooltip with description)
    const infoIcon = document.createElement("span");
    infoIcon.className = "feature-info-icon";
    infoIcon.textContent = "i";
    infoIcon.title = feature.description;
    info.appendChild(infoIcon);

    row.appendChild(info);

    // Right: toggle or lock
    if (accessible) {
      const toggleLabel = document.createElement("label");
      toggleLabel.className = "toggle-switch";

      const toggleInput = document.createElement("input");
      toggleInput.type = "checkbox";
      toggleInput.checked = enabled;
      toggleInput.dataset.featureId = feature.id;
      toggleInput.addEventListener("change", handleFeatureToggle);

      const slider = document.createElement("span");
      slider.className = "toggle-slider";

      toggleLabel.appendChild(toggleInput);
      toggleLabel.appendChild(slider);
      row.appendChild(toggleLabel);
    } else {
      const lock = document.createElement("span");
      lock.className = "feature-lock";
      lock.textContent = "\uD83D\uDD12";
      lock.title = `Requires ${requiredTier === 1 ? "BtrKorone+" : "BtrKorone Rex"}`;
      row.appendChild(lock);
    }

    container.appendChild(row);
  });

  if (features.length === 0) {
    const empty = document.createElement("p");
    empty.style.cssText = "color:#666; font-size:12px; text-align:center; padding:20px 0;";
    empty.textContent = "No features in this tier.";
    container.appendChild(empty);
  }
}

async function handleFeatureToggle(e) {
  const featureId = e.target.dataset.featureId;
  const enabled = e.target.checked;
  await sendMessage({ type: "TOGGLE_FEATURE", featureId, enabled });
  if (featureState && featureState[featureId]) {
    featureState[featureId].enabled = enabled;
  }
}

// === Top Action Buttons ===

function setupActions() {
  document.getElementById("btn-reload").addEventListener("click", () => {
    chrome.runtime.reload();
  });

  document.getElementById("btn-clear-cache").addEventListener("click", async () => {
    if (confirm("Clear all extension cache and settings? You'll need to re-link your account.")) {
      await chrome.storage.local.clear();
      alert("Cache cleared. Reloading extension...");
      chrome.runtime.reload();
    }
  });

  document.getElementById("btn-manage").addEventListener("click", () => {
    if (currentStatus && currentStatus.userId) {
      window.open("https://www.pekora.zip/users/" + currentStatus.userId + "/profile", "_blank");
    } else {
      openVerifyModal();
    }
  });

  document.getElementById("btn-activate").addEventListener("click", () => {
    openVerifyModal();
  });

  document.getElementById("btn-support").addEventListener("click", () => {
    window.open("https://github.com/midnightfully/BtrKorone/issues", "_blank");
  });

  document.getElementById("btn-discord").addEventListener("click", () => {
    window.open("https://discord.gg/", "_blank"); // Update with actual Discord invite
  });

  document.getElementById("btn-bug").addEventListener("click", () => {
    window.open("https://github.com/midnightfully/BtrKorone/issues/new?labels=bug", "_blank");
  });

  document.getElementById("btn-feature").addEventListener("click", () => {
    window.open("https://github.com/midnightfully/BtrKorone/issues/new?labels=enhancement", "_blank");
  });

  // Tier upgrade buttons (shown inside the Plus / Rex tab panels)
  const plusBtn = document.getElementById("upgrade-plus-btn");
  if (plusBtn) {
    plusBtn.addEventListener("click", () => openGamepassPage(BTRKORONE.TIERS.PLUS));
  }
  const rexBtn = document.getElementById("upgrade-rex-btn");
  if (rexBtn) {
    rexBtn.addEventListener("click", () => openGamepassPage(BTRKORONE.TIERS.REX));
  }
}

function openGamepassPage(tier) {
  if (!tier || !tier.gamepassUrl) return;
  window.open(tier.gamepassUrl, "_blank");
}

// === Verification Modal ===

function openVerifyModal() {
  document.getElementById("verify-modal").style.display = "flex";

  // Populate user ID if already linked
  if (currentStatus && currentStatus.userId) {
    document.getElementById("input-userid").value = currentStatus.userId;
    document.getElementById("btn-logout").style.display = "block";
  }
}

function closeVerifyModal() {
  document.getElementById("verify-modal").style.display = "none";
  document.getElementById("verification-message").style.display = "none";
}

function setupModal() {
  document.getElementById("btn-close-modal").addEventListener("click", closeVerifyModal);

  document.getElementById("btn-generate-token").addEventListener("click", async () => {
    const userId = document.getElementById("input-userid").value.trim();
    if (!userId || isNaN(userId)) {
      showMessage("Enter a valid Korone User ID (number from your profile URL).", "error");
      return;
    }

    const btn = document.getElementById("btn-generate-token");
    btn.textContent = "Generating...";
    btn.disabled = true;

    const result = await sendMessage({ type: "GENERATE_TOKEN", userId });

    btn.textContent = "Generate Verification Token";
    btn.disabled = false;

    if (result.error) { showMessage(result.error, "error"); return; }

    // Update user avatar in the header
    document.getElementById("user-avatar").src =
      `https://www.pekora.zip/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`;
    if (result.username) document.getElementById("user-name").textContent = result.username;

    document.getElementById("token-display").style.display = "block";
    document.getElementById("token-value").textContent = result.token;
    document.getElementById("btn-verify").style.display = "block";
    showMessage("Token generated! Paste it in your Korone About Me, then click Verify.", "info");
  });

  document.getElementById("btn-copy-token").addEventListener("click", () => {
    const token = document.getElementById("token-value").textContent;
    const btn = document.getElementById("btn-copy-token");
    navigator.clipboard.writeText(token).then(() => {
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy"; }, 2000);
    });
  });

  document.getElementById("btn-verify").addEventListener("click", async () => {
    const userId = document.getElementById("input-userid").value.trim();
    const token = document.getElementById("token-value").textContent;
    if (!userId || !token) { showMessage("Generate a token first.", "error"); return; }

    const btn = document.getElementById("btn-verify");
    btn.textContent = "Linking...";
    btn.disabled = true;

    const result = await sendMessage({ type: "LINK_ACCOUNT", userId, token });

    btn.textContent = "Verify & Link Account";
    btn.disabled = false;

    if (result.success) {
      showMessage(result.message || "Account linked.", "success");
      await loadFullState();
      setTimeout(closeVerifyModal, 2000);
    } else {
      showMessage(result.message || result.error, "error");
    }
  });

  document.getElementById("btn-logout").addEventListener("click", async () => {
    if (confirm("Unlink account and remove premium access?")) {
      await sendMessage({ type: "LOGOUT" });
      showMessage("Account unlinked.", "info");
      await loadFullState();
      setTimeout(closeVerifyModal, 1500);
    }
  });
}

// === Helpers ===

function sendMessage(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, r => resolve(r || null)));
}

function showMessage(text, type) {
  const el = document.getElementById("verification-message");
  el.textContent = text;
  el.className = `modal-message ${type}`;
  el.style.display = "block";
}
