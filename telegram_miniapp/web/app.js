const tg = window.Telegram?.WebApp ?? null;

const launchState = document.getElementById("launch-state");
const authState = document.getElementById("auth-state");
const statusMessage = document.getElementById("status-message");
const validateButton = document.getElementById("validate-button");
const sendDataButton = document.getElementById("send-data-button");
const expandButton = document.getElementById("expand-button");
const manualSection = document.getElementById("manual-section");
const manualInitData = document.getElementById("manual-init-data");
const platformValue = document.getElementById("platform-value");
const versionValue = document.getElementById("version-value");
const schemeValue = document.getElementById("scheme-value");
const startParamValue = document.getElementById("start-param-value");
const userJson = document.getElementById("user-json");
const serverJson = document.getElementById("server-json");
const initDataPreview = document.getElementById("init-data-preview");
let devVersion = null;

function isLocalDevHost() {
  return ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function setLaunchBadge(label, kind) {
  launchState.textContent = label;
  launchState.className = `status-badge ${kind}`;
}

function setAuthBadge(label, kind) {
  authState.textContent = label;
  authState.className = `status-badge ${kind}`;
}

function getInitData() {
  if (tg?.initData) {
    return tg.initData;
  }
  return manualInitData.value.trim();
}

function renderClientState() {
  if (!tg) {
    setLaunchBadge("Browser only", "warning");
    setAuthBadge("No Telegram", "muted");
    statusMessage.textContent =
      "Сейчас страница открыта как обычный сайт. Для реальной проверки открой ее из Telegram.";
    manualSection.classList.remove("hidden");
    sendDataButton.disabled = true;
    platformValue.textContent = "browser";
    versionValue.textContent = "-";
    schemeValue.textContent = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
    startParamValue.textContent = new URLSearchParams(window.location.search).get("tgWebAppStartParam") ?? "-";
    return;
  }

  tg.ready();
  tg.expand();
  setLaunchBadge("Inside Telegram", "success");
  statusMessage.textContent =
    "Мини-апп поднялся внутри Telegram. Следующий шаг — проверить серверную подпись initData.";

  platformValue.textContent = tg.platform || "-";
  versionValue.textContent = tg.version || "-";
  schemeValue.textContent = tg.colorScheme || "-";
  startParamValue.textContent = tg.initDataUnsafe?.start_param || "-";
  userJson.textContent = pretty(tg.initDataUnsafe?.user ?? { message: "No user in initDataUnsafe" });
  initDataPreview.textContent = tg.initData || "No initData from Telegram";

  if (tg.MainButton) {
    tg.MainButton.setText("Send ping to bot");
    tg.MainButton.show();
    tg.MainButton.onClick(sendPingToBot);
  }
}

async function validateInitData() {
  const initData = getInitData();

  if (!initData) {
    setAuthBadge("Missing initData", "error");
    statusMessage.textContent = "Пока нечего проверять: initData пустой.";
    serverJson.textContent = pretty({ ok: false, reason: "initData is empty" });
    return;
  }

  validateButton.disabled = true;
  setAuthBadge("Checking...", "warning");
  statusMessage.textContent = "Сервер проверяет подпись Telegram initData.";

  try {
    const response = await fetch("/api/telegram/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    const payload = await response.json();
    serverJson.textContent = pretty(payload);

    if (payload.ok) {
      setAuthBadge(payload.auth_is_fresh ? "Verified" : "Expired", payload.auth_is_fresh ? "success" : "warning");
      statusMessage.textContent = payload.auth_is_fresh
        ? "Подпись Telegram валидна. Авторизация на первом шаге работает."
        : "Подпись валидна, но auth_date слишком старый.";
      tg?.HapticFeedback?.notificationOccurred?.("success");
    } else {
      setAuthBadge("Rejected", "error");
      statusMessage.textContent = payload.reason || "Сервер отклонил initData.";
      tg?.HapticFeedback?.notificationOccurred?.("error");
    }
  } catch (error) {
    setAuthBadge("Server error", "error");
    statusMessage.textContent = `Ошибка запроса к серверу: ${error.message}`;
    serverJson.textContent = pretty({ ok: false, reason: error.message });
  } finally {
    validateButton.disabled = false;
  }
}

function sendPingToBot() {
  if (!tg?.sendData) {
    statusMessage.textContent = "sendData доступен только внутри Telegram Mini App.";
    return;
  }

  const payload = {
    type: "trainer_stub_ping",
    sent_at: new Date().toISOString(),
    platform: tg.platform || null,
    user_id: tg.initDataUnsafe?.user?.id || null,
  };

  statusMessage.textContent =
    "Отправляю ping в бот. Telegram закроет Mini App сразу после sendData.";
  tg.sendData(JSON.stringify(payload));
}

function expandMiniApp() {
  tg?.expand?.();
}

async function checkDevVersion() {
  try {
    const response = await fetch(`/api/dev/version?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (!payload.version) {
      return;
    }

    if (!devVersion) {
      devVersion = payload.version;
      return;
    }

    if (devVersion !== payload.version) {
      window.location.reload();
    }
  } catch (_error) {
    // Ignore temporary dev-server restarts.
  }
}

validateButton.addEventListener("click", validateInitData);
sendDataButton.addEventListener("click", sendPingToBot);
expandButton.addEventListener("click", expandMiniApp);

renderClientState();

if (tg?.initData) {
  validateInitData();
}

if (isLocalDevHost()) {
  checkDevVersion();
  window.setInterval(checkDevVersion, 1000);
}
