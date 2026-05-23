/**
 * BtrKorone - Popup Script
 * Handles popup UI interactions, settings, and premium verification flow
 */

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize UI
  await loadStatus();
  setupTabs();
  setupVerification();
  setupSettings();
});

// --- Tab Navigation ---
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

// --- Status Loading ---
async function loadStatus() {
  const status = await sendMessage({ type: "GET_STATUS" });
  if (!status) return;

  // Update version
  document.getElementById("version").textContent = `v${status.version}`;

  // Update tier badge
  const tierBadge = document.getElementById("tier-badge");
  tierBadge.textContent = status.tierInfo.label;
  tierBadge.className = "tier-badge";
  if (status.tier === 1) tierBadge.classList.add("plus");
  if (status.tier === 2) tierBadge.classList.add("pro");

  // Update status tab
  document.getElementById("status-enabled").textContent = 
    status.settings.enabled ? "Enabled" : "Disabled";
  document.getElementById("status-enabled").className = 
    `status-value ${status.settings.enabled ? "enabled" : ""}`;

  document.getElementById("status-account").textContent = 
    status.username ? `${status.username} (${status.userId})` : "Not linked";

  document.getElementById("status-tier").textContent = status.tierInfo.label;
  document.getElementById("status-tier").style.color = status.tierInfo.color;

  document.getElementById("status-verified").textContent = 
    status.lastVerified ? formatTimeAgo(status.lastVerified) : "Never";

  // Show recheck button if account is linked
  if (status.userId) {
    document.getElementById("btn-recheck").style.display = "block";
    document.getElementById("btn-logout").style.display = "block";
    document.getElementById("input-userid").value = status.userId;
  }

  // Load settings into toggles
  loadSettingsToUI(status.settings, status.tier);
}

// --- Premium Verification ---
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

    const result = await sendMessage({ type: "GENERATE_TOKEN", userId });
    if (result.error) {
      showMessage(result.error, "error");
      return;
    }

    // Show token
    document.getElementById("token-display").style.display = "block";
    document.getElementById("token-value").textContent = result.token;
    document.getElementById("btn-verify").style.display = "block";
    showMessage(result.instructions, "info");
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

    btnVerify.textContent = "Verify & Activate";
    btnVerify.disabled = false;

    if (result.success) {
      showMessage(result.message, "success");
      await loadStatus(); // Refresh UI
    } else {
      showMessage(result.message || result.error, "error");
    }
  });

  btnLogout.addEventListener("click", async () => {
    if (confirm("This will unlink your account and remove premium access. Continue?")) {
      await sendMessage({ type: "LOGOUT" });
      showMessage("Account unlinked.", "info");
      await loadStatus();
    }
  });

  btnRecheck.addEventListener("click", async () => {
    btnRecheck.textContent = "Checking...";
    btnRecheck.disabled = true;
    await sendMessage({ type: "FORCE_RECHECK" });
    btnRecheck.textContent = "Re-check Premium";
    btnRecheck.disabled = false;
    await loadStatus();
  });
}

// --- Settings ---
function setupSettings() {
  const settingToggles = document.querySelectorAll("[id^='setting-']");
  settingToggles.forEach((toggle) => {
    toggle.addEventListener("change", async () => {
      const key = toggle.id.replace("setting-", "");
      const settings = { [key]: toggle.checked };
      await sendMessage({ type: "UPDATE_SETTINGS", settings });
    });
  });
}

function loadSettingsToUI(settings, tier) {
  for (const [key, value] of Object.entries(settings)) {
    const toggle = document.getElementById(`setting-${key}`);
    if (toggle) {
      toggle.checked = value;

      // Disable premium features based on tier
      const row = toggle.closest(".toggle-row");
      if (BTRKORONE.FEATURES.PLUS.includes(key) && tier < 1) {
        row.classList.add("disabled");
      } else if (BTRKORONE.FEATURES.PRO.includes(key) && tier < 2) {
        row.classList.add("disabled");
      } else {
        row.classList.remove("disabled");
      }
    }
  }
}

// --- Helpers ---
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

function showMessage(text, type) {
  const el = document.getElementById("verification-message");
  el.textContent = text;
  el.className = `message ${type}`;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 8000);
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
