const SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const RX_UUID = "12345678-1234-5678-1234-56789abcdef1";
const TX_UUID = "12345678-1234-5678-1234-56789abcdef2";

const STORAGE_KEY = "ai_kbd_webapp_settings_v1";

function resetViewport() {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) {
    return;
  }
  viewport.setAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover");
}

const els = {
  btnConnect: document.querySelector("#btnConnect"),
  btnDisconnect: document.querySelector("#btnDisconnect"),
  btnPing: document.querySelector("#btnPing"),
  btnStatus: document.querySelector("#btnStatus"),
  btnStopSend: document.querySelector("#btnStopSend"),
  btnBold: document.querySelector("#btnBold"),
  btnItalic: document.querySelector("#btnItalic"),
  btnUnderline: document.querySelector("#btnUnderline"),
  btnSendText: document.querySelector("#btnSendText"),
  btnSendRaw: document.querySelector("#btnSendRaw"),
  btnToggleSettings: document.querySelector("#btnToggleSettings"),
  btnToggleMacro: document.querySelector("#btnToggleMacro"),
  connState: document.querySelector("#connState"),
  connDeviceName: document.querySelector("#connDeviceName"),
  settingsContent: document.querySelector("#settingsContent"),
  macroContent: document.querySelector("#macroContent"),
  delayInput: document.querySelector("#delayInput"),
  speedInput: document.querySelector("#speedInput"),
  mdMode: document.querySelector("#mdMode"),
  textInput: document.querySelector("#textInput"),
  rawInput: document.querySelector("#rawInput"),
  macroEditor: document.querySelector("#macroEditor"),
  macroTextInput: document.querySelector("#macroTextInput"),
  macroDelayInput: document.querySelector("#macroDelayInput"),
  macroProfileSelect: document.querySelector("#macroProfileSelect"),
  macroProfileName: document.querySelector("#macroProfileName"),
  btnMacroSaveProfile: document.querySelector("#btnMacroSaveProfile"),
  btnMacroLoadProfile: document.querySelector("#btnMacroLoadProfile"),
  btnMacroImportJson: document.querySelector("#btnMacroImportJson"),
  btnMacroDeleteProfile: document.querySelector("#btnMacroDeleteProfile"),
  macroImportJsonFile: document.querySelector("#macroImportJsonFile"),
  btnMacroAddText: document.querySelector("#btnMacroAddText"),
  btnMacroAddDelay: document.querySelector("#btnMacroAddDelay"),
  btnMacroRun: document.querySelector("#btnMacroRun"),
  btnMacroClear: document.querySelector("#btnMacroClear"),
  logBox: document.querySelector("#logBox"),
  btnKeys: document.querySelectorAll(".btnKey"),
  btnMacroKeys: document.querySelectorAll(".btnMacroKey"),
};

let device = null;
let server = null;
let rxChar = null;
let txChar = null;
let isConnecting = false;
let isTextSending = false;
let isMacroRunning = false;
let settingsWriteWarned = false;
let runtimeMacroProfiles = {};
let sendStopToken = 0;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_GATT_WRITE_BYTES = 512;
const TEXT_PREFIX = "TEXT:";

function now() {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false });
}

function log(line) {
  els.logBox.textContent += `[${now()}] ${line}\n`;
  els.logBox.scrollTop = els.logBox.scrollHeight;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentSendToken() {
  return sendStopToken;
}

function isSendStopped(token) {
  return token !== sendStopToken;
}

async function requestStopSending() {
  sendStopToken += 1;
  log("Send stop requested.");
  if (device?.gatt?.connected && rxChar) {
    try {
      await writeCommand("STOP");
    } catch (err) {
      log(`STOP send failed: ${err}`);
    }
  }
}

async function waitWithStop(ms, token) {
  let left = Math.max(0, Number(ms) || 0);
  while (left > 0) {
    if (isSendStopped(token)) {
      return false;
    }
    const step = Math.min(left, 60);
    await sleep(step);
    left -= step;
  }
  return !isSendStopped(token);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadSettings() {
  const defaults = {
    delaySec: 2,
    speedPercent: 90,
    mdMode: false,
    settingsExpanded: false,
    macroScript: "",
    macroSelectedProfile: "",
    macroProfiles: {},
    lastDeviceId: "",
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw);
    const profiles = {};
    if (parsed?.macroProfiles && typeof parsed.macroProfiles === "object") {
      for (const [name, script] of Object.entries(parsed.macroProfiles)) {
        if (typeof name === "string" && typeof script === "string") {
          const normalized = normalizeMacroProfileName(name) || `\ud504\ub85c\ud544_${Object.keys(profiles).length + 1}`;
          profiles[normalized] = script;
        }
      }
    }
    return {
      delaySec: Number.isFinite(parsed.delaySec) ? parsed.delaySec : defaults.delaySec,
      speedPercent: Number.isFinite(parsed.speedPercent) ? parsed.speedPercent : defaults.speedPercent,
      mdMode: Boolean(parsed.mdMode),
      settingsExpanded: Boolean(parsed.settingsExpanded),
      macroScript: typeof parsed.macroScript === "string" ? parsed.macroScript : defaults.macroScript,
      macroSelectedProfile:
        typeof parsed.macroSelectedProfile === "string"
          ? parsed.macroSelectedProfile
          : defaults.macroSelectedProfile,
      macroProfiles: profiles,
      lastDeviceId: typeof parsed.lastDeviceId === "string" ? parsed.lastDeviceId : defaults.lastDeviceId,
    };
  } catch {
    return defaults;
  }
}

function buildSettingsPayload(extra = {}) {
  const prev = loadSettings();
  return {
    ...prev,
    delaySec: getDelaySec(),
    speedPercent: getSpeedPercent(),
    mdMode: Boolean(els.mdMode?.checked),
    settingsExpanded: !els.settingsContent.classList.contains("is-collapsed"),
    macroScript: els.macroEditor?.value ?? "",
    macroSelectedProfile: els.macroProfileSelect?.value ?? "",
    ...extra,
  };
}

function saveSettings(extra = {}) {
  const payload = buildSettingsPayload(extra);
  if (payload.macroProfiles && typeof payload.macroProfiles === "object") {
    runtimeMacroProfiles = { ...payload.macroProfiles };
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    if (!settingsWriteWarned) {
      settingsWriteWarned = true;
      log(`\uC124\uC815 \uC800\uC7A5 \uC2E4\uD328(localStorage): ${err}`);
    }
  }
}

function normalizeMacroProfilesPayload(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid json payload");
  }
  const source =
    raw && typeof raw === "object" && raw.macroProfiles && typeof raw.macroProfiles === "object"
      ? raw.macroProfiles
      : raw;

  const profiles = {};
  for (const [name, script] of Object.entries(source)) {
    if (typeof name === "string" && typeof script === "string") {
      const normalizedName = normalizeMacroProfileName(name);
      if (normalizedName) {
        profiles[normalizedName] = script;
      }
    }
  }

  if (!Object.keys(profiles).length) {
    throw new Error("no valid macro profiles");
  }
  return profiles;
}

async function importMacroProfilesFromJsonFile(file) {
  if (!file) {
    return;
  }
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("json parse failed");
  }
  const imported = normalizeMacroProfilesPayload(parsed);
  const merged = { ...getMacroProfiles(), ...imported };
  const selected = Object.keys(imported)[0] || "";

  saveSettings({ macroProfiles: merged, macroSelectedProfile: selected });
  renderMacroProfileOptions(selected);
  els.macroProfileName.value = selected;
  if (selected && merged[selected]) {
    els.macroEditor.value = merged[selected];
  }
}

function applySettingsToUI() {
  const s = loadSettings();
  runtimeMacroProfiles = { ...s.macroProfiles };
  els.delayInput.value = String(s.delaySec);
  els.speedInput.value = String(s.speedPercent);
  els.mdMode.checked = s.mdMode;
  els.macroEditor.value = s.macroScript;
  els.macroProfileName.value = s.macroSelectedProfile;
  setSettingsExpanded(s.settingsExpanded);
  setMacroExpanded(false);
  renderMacroProfileOptions(s.macroSelectedProfile);
}

function setSettingsExpanded(expanded) {
  els.settingsContent.classList.toggle("is-collapsed", !expanded);
  els.btnToggleSettings.textContent = expanded
    ? "\uc811\uae30"
    : "\ud3bc\uce58\uae30";
}

function setMacroExpanded(expanded) {
  els.macroContent.classList.toggle("is-collapsed", !expanded);
  els.btnToggleMacro.textContent = expanded
    ? "\uc811\uae30"
    : "\uc5f4\uae30";
}

function getDelaySec() {
  const sec = Number(els.delayInput?.value ?? 2);
  if (!Number.isFinite(sec) || sec < 0) {
    return 2;
  }
  return sec;
}

function getDelayMs() {
  return Math.floor(getDelaySec() * 1000);
}

function getSpeedPercent() {
  const p = Number(els.speedInput?.value ?? 90);
  if (!Number.isFinite(p)) {
    return 90;
  }
  return clamp(Math.round(p), 20, 300);
}

function setConnectedState(isConnected) {
  els.btnConnect.disabled = isConnected;
  els.btnDisconnect.disabled = !isConnected;
  els.btnPing.disabled = !isConnected;
  els.btnStatus.disabled = !isConnected;
  els.btnStopSend.disabled = !isConnected;
  els.btnSendText.disabled = !isConnected;
  els.btnSendRaw.disabled = !isConnected;
  els.btnBold.disabled = !isConnected;
  els.btnItalic.disabled = !isConnected;
  els.btnUnderline.disabled = !isConnected;
  els.btnMacroRun.disabled = !isConnected;
  els.btnKeys.forEach((btn) => (btn.disabled = !isConnected));
  els.connState.textContent = isConnected
    ? "\uc0c1\ud0dc: \uc5f0\uacb0\ub428"
    : "\uc0c1\ud0dc: \uc5f0\uacb0 \uc548 \ub428";
  if (els.connDeviceName) {
    els.connDeviceName.textContent = isConnected && device?.name
      ? `(${device.name})`
      : "";
  }
}

function sanitizeMacroProfileName(input) {
  let name = String(input || "").replace(/\s+/g, " ").trim();
  name = name.replace(/\?{2,}/g, " ");
  name = name.replace(/[^\w\s\-\[\]\(\)\u3131-\u318E\uAC00-\uD7A3]/g, "");
  return name.trim();
}

function normalizeMacroProfileName(input) {
  return sanitizeMacroProfileName(input).slice(0, 40);
}

function getMacroProfiles() {
  return runtimeMacroProfiles;
}

function renderMacroProfileOptions(selected = "") {
  const profiles = getMacroProfiles();
  const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b, "ko-KR"));
  const current = selected && profiles[selected] ? selected : names[0] || "";

  els.macroProfileSelect.innerHTML = "";
  if (!names.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "\uc800\uc7a5\ub41c \ud504\ub85c\ud544 \uc5c6\uc74c";
    els.macroProfileSelect.appendChild(placeholder);
    els.macroProfileSelect.value = "";
    return;
  }

  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    els.macroProfileSelect.appendChild(opt);
  }

  els.macroProfileSelect.value = current;
}

function appendMacroLines(lines) {
  const valid = lines.map((line) => String(line)).filter((line) => line.length > 0);
  if (!valid.length) {
    return;
  }
  const base = els.macroEditor.value;
  const prefix = base.length > 0 && !base.endsWith("\n") ? "\n" : "";
  els.macroEditor.value = `${base}${prefix}${valid.join("\n")}\n`;
  saveSettings();
}

function getMacroDelayMs() {
  const ms = Number(els.macroDelayInput.value);
  if (!Number.isFinite(ms) || ms < 0) {
    return 300;
  }
  return Math.round(ms);
}

function parseMacroScript(script) {
  const steps = [];
  const lines = script.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (/^TEXT:/i.test(raw)) {
      const payload = raw.split(":", 2)[1] ?? "";
      steps.push({ type: "text", value: payload });
      continue;
    }

    if (/^KEY:/i.test(line)) {
      const payload = line.split(":", 2)[1]?.trim();
      if (!payload) {
        throw new Error(`\uB77C\uC778 ${i + 1}: KEY \uAC12\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.`);
      }
      steps.push({ type: "key", value: payload.toUpperCase() });
      continue;
    }

    if (/^DELAY:/i.test(line)) {
      const payload = line.split(":", 2)[1]?.trim();
      const ms = Number(payload);
      if (!Number.isFinite(ms) || ms < 0) {
        throw new Error(`\uB77C\uC778 ${i + 1}: DELAY \uAC12\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
      }
      steps.push({ type: "delay", value: Math.round(ms) });
      continue;
    }

    steps.push({ type: "raw", value: raw });
  }

  return steps;
}

async function runMacroScript() {
  if (isMacroRunning) {
    log("\uC774\uBBF8 \uB9E4\uD06C\uB85C\uAC00 \uC2E4\uD589 \uC911\uC785\uB2C8\uB2E4.");
    return;
  }

  const script = els.macroEditor.value;
  const sendToken = currentSendToken();
  if (!script.trim()) {
    log("\uB9E4\uD06C\uB85C \uD3B8\uC9D1\uCC3D\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    return;
  }

  const ok = await ensureConnected();
  if (!ok || !rxChar) {
    log("Not connected. Click Connect first.");
    return;
  }

  let steps = [];
  try {
    steps = parseMacroScript(script);
  } catch (err) {
    log(`\uB9E4\uD06C\uB85C \uD30C\uC2F1 \uC2E4\uD328: ${err}`);
    return;
  }

  if (!steps.length) {
    log("\uC2E4\uD589\uD560 \uB9E4\uD06C\uB85C \uB2E8\uACC4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
    return;
  }

  isMacroRunning = true;
  els.btnMacroRun.disabled = true;
  log(`Macro run start: ${steps.length} steps`);

  try {
    await applyTypingSpeed();
    const delayMs = getDelayMs();
    if (delayMs > 0) {
      log(`\uC804\uC1A1 \uC9C0\uC5ED ${delayMs / 1000}s \uD6C4 \uB9E4\uD06C\uB85C \uC2E4\uD589`);
      const okDelay = await waitWithStop(delayMs, sendToken);
      if (!okDelay) {
        log("Macro run cancelled.");
        return;
      }
    }

    for (const step of steps) {
      if (isSendStopped(sendToken)) {
        log("Macro run cancelled.");
        return;
      }
      if (step.type === "delay") {
        log(`macro delay ${step.value}ms`);
        const ok = await waitWithStop(step.value, sendToken);
        if (!ok) {
          log("Macro run cancelled.");
          return;
        }
        continue;
      }
      if (step.type === "text") {
        const sent = await sendTextPayload(step.value, { confirmLarge: false, sendToken });
        if (!sent) {
          return;
        }
        const ok = await waitWithStop(40, sendToken);
        if (!ok) {
          log("Macro run cancelled.");
          return;
        }
        continue;
      }
      if (step.type === "key") {
        if (isSendStopped(sendToken)) {
          log("Macro run cancelled.");
          return;
        }
        await writeCommand(`KEY:${step.value}`);
        const ok = await waitWithStop(40, sendToken);
        if (!ok) {
          log("Macro run cancelled.");
          return;
        }
        continue;
      }
      if (isSendStopped(sendToken)) {
        log("Macro run cancelled.");
        return;
      }
      await writeCommand(step.value);
      const ok = await waitWithStop(40, sendToken);
      if (!ok) {
        log("Macro run cancelled.");
        return;
      }
    }

    log("\uB9E4\uD06C\uB85C \uC644\uB8CC");
  } catch (err) {
    log(`\uB9E4\uD06C\uB85C \uC2E4\uD589 \uC2E4\uD328: ${err}`);
  } finally {
    isMacroRunning = false;
    if (device?.gatt?.connected) {
      els.btnMacroRun.disabled = false;
    }
  }
}

function bindDevice(nextDevice) {
  if (device === nextDevice || !nextDevice) {
    return;
  }
  device = nextDevice;
  device.addEventListener("gattserverdisconnected", onDisconnected);
  saveSettings({ lastDeviceId: device.id || "" });
}

async function connect() {
  if (!navigator.bluetooth) {
    log("Web Bluetooth\uB97C \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uBE0C\uB77C\uC6B0\uC800\uC785\uB2C8\uB2E4.");
    return;
  }

  if (isConnecting) {
    return;
  }
  isConnecting = true;

  try {
    if (!device) {
      log("BLE \uC7A5\uCE58 \uC120\uD0DD \uC911");
      const picked = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID],
      });
      bindDevice(picked);
      log(`\uC7A5\uCE58 \uC120\uD0DD: ${device?.name || "<no-name>"} (${device?.id || "no-id"})`);
    } else {
      log("\uAE30\uC874 \uC120\uD0DD \uC7A5\uCE58\uB85C \uC5F0\uACB0 \uC2DC\uB3C4");
    }

    await setupGatt();
    setConnectedState(true);
    log("GATT \uC5F0\uACB0 \uC644\uB8CC");
    await applyTypingSpeed();
  } catch (err) {
    log(`\uC5F0\uACB0 \uC2E4\uD328: ${err}`);
    setConnectedState(false);
  } finally {
    isConnecting = false;
  }
}

async function tryAutoReconnect() {
  if (!navigator.bluetooth || typeof navigator.bluetooth.getDevices !== "function") {
    log("\uC790\uB3D9 \uC7AC\uC5F0\uACB0 \uBBF8\uC9C0\uC6D0 \uBE0C\uB77C\uC6B0\uC800(getDevices \uBBF8\uC9C0\uC6D0)");
    return;
  }

  const { lastDeviceId } = loadSettings();
  if (!lastDeviceId) {
    return;
  }

  try {
    const devices = await navigator.bluetooth.getDevices();
    const found = devices.find((d) => d.id === lastDeviceId);
    if (!found) {
      log("\uC790\uB3D9 \uC7AC\uC5F0\uACB0 \uB300\uC0C1 \uC7A5\uCE58\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      return;
    }

    bindDevice(found);
    log(`\uC790\uB3D9 \uC7AC\uC5F0\uACB0 \uC2DC\uB3C4: ${device?.name || "<no-name>"}`);
    await setupGatt();
    setConnectedState(true);
    log("\uC790\uB3D9 \uC7AC\uC5F0\uACB0 \uC644\uB8CC");
    await applyTypingSpeed();
  } catch (err) {
    log(`\uC790\uB3D9 \uC7AC\uC5F0\uACB0 \uC2E4\uD328: ${err}`);
    setConnectedState(false);
  }
}

async function setupGatt() {
  if (!device) {
    throw new Error("device not selected");
  }

  if (!device.gatt.connected) {
    server = await device.gatt.connect();
  } else {
    server = device.gatt;
  }

  const service = await server.getPrimaryService(SERVICE_UUID);
  rxChar = await service.getCharacteristic(RX_UUID);
  txChar = await service.getCharacteristic(TX_UUID);
  await txChar.startNotifications();
  txChar.removeEventListener("characteristicvaluechanged", onNotify);
  txChar.addEventListener("characteristicvaluechanged", onNotify);
}

async function ensureConnected() {
  if (device?.gatt?.connected && rxChar && txChar) {
    return true;
  }

  try {
    await setupGatt();
    setConnectedState(true);
    log("\uC790\uB3D9 \uC7AC\uC5F0\uACB0 \uC644\uB8CC");
    await applyTypingSpeed();
    return true;
  } catch (err) {
    log(`\uC790\uB3D9 \uC7AC\uC5F0\uACB0 \uC2E4\uD328: ${err}`);
    setConnectedState(false);
    return false;
  }
}

function onDisconnected() {
  log("Device disconnected.");
  setConnectedState(false);
  server = null;
  rxChar = null;
  txChar = null;
}

async function disconnect() {
  try {
    if (txChar) {
      await txChar.stopNotifications();
    }
  } catch (err) {
    log(`\uC54C\uB9BC \uD574\uC81C \uC624\uB958: ${err}`);
  }

  if (device?.gatt?.connected) {
    device.gatt.disconnect();
  }
  setConnectedState(false);
}

function onNotify(event) {
  const text = decoder.decode(event.target.value);
  log(`notify <= ${text}`);
}

async function writeCommand(command) {
  await rxChar.writeValueWithResponse(encoder.encode(command));
  log(`write => ${command}`);
}

function utf8ByteLength(text) {
  return encoder.encode(text).length;
}

function splitTextByUtf8Bytes(text, maxBytes) {
  const chunks = [];
  let current = "";
  let currentBytes = 0;

  for (const ch of text) {
    const b = utf8ByteLength(ch);
    if (b > maxBytes) {
      throw new Error("single character exceeds chunk size");
    }
    if (currentBytes + b > maxBytes) {
      chunks.push(current);
      current = ch;
      currentBytes = b;
      continue;
    }
    current += ch;
    currentBytes += b;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function shouldConfirmLargeText(text) {
  const commandBytes = utf8ByteLength(`${TEXT_PREFIX}${text}`);
  return commandBytes > MAX_GATT_WRITE_BYTES;
}

function confirmLargeTextIfNeeded(text) {
  const commandBytes = utf8ByteLength(`${TEXT_PREFIX}${text}`);
  if (commandBytes <= MAX_GATT_WRITE_BYTES) {
    return true;
  }
  return window.confirm(
    `\uD14D\uC2A4\uD2B8 \uD06C\uAE30\uAC00 ${commandBytes}\uBC14\uC774\uD2B8\uC785\uB2C8\uB2E4.\n` +
      "\uC790\uB3D9 \uBD84\uD560 \uC804\uC1A1\uC744 \uC9C4\uD589\uD558\uBA74 \uC2DC\uAC04\uC774 \uB354 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.\n" +
      "\uACC4\uC18D\uD560\uAE4C\uC694?"
  );
}

async function sendTextPayload(text, options = {}) {
  const { confirmLarge = true, sendToken = currentSendToken() } = options;

  const ok = await ensureConnected();
  if (!ok || !rxChar) {
    log("Not connected. Click Connect first.");
    return false;
  }

  if (confirmLarge) {
    const proceed = confirmLargeTextIfNeeded(text);
    if (!proceed) {
      log("Send cancelled: large text prompt dismissed.");
      return false;
    }
  }

  const maxTextBytes = MAX_GATT_WRITE_BYTES - utf8ByteLength(TEXT_PREFIX);
  const chunks = splitTextByUtf8Bytes(text, maxTextBytes);
  if (chunks.length > 1) {
    log(`Chunked send: ${chunks.length} chunks`);
  }

  for (const chunk of chunks) {
    if (isSendStopped(sendToken)) {
      log("Text send cancelled.");
      return false;
    }
    await writeCommand(`${TEXT_PREFIX}${chunk}`);
    const chunkOk = await waitWithStop(40, sendToken);
    if (!chunkOk) {
      log("Text send cancelled.");
      return false;
    }
  }
  return true;
}

async function sendCommand(command, options = {}) {
  const { applyDelay = true, sendToken = currentSendToken() } = options;

  const ok = await ensureConnected();
  if (!ok || !rxChar) {
    log("Not connected. Click Connect first.");
    return false;
  }

  try {
    if (applyDelay) {
      const delayMs = getDelayMs();
      if (delayMs > 0) {
        log(`delay ${delayMs / 1000}s \uD6C4 \uC804\uC1A1`);
        const okDelay = await waitWithStop(delayMs, sendToken);
        if (!okDelay) {
          log("Send cancelled.");
          return false;
        }
      }
    }

    if (isSendStopped(sendToken)) {
      log("Send cancelled.");
      return false;
    }
    await writeCommand(command);
    return true;
  } catch (err) {
    log(`\uC804\uC1A1 \uC2E4\uD328: ${err}`);
    return false;
  }
}

async function applyTypingSpeed() {
  const speed = getSpeedPercent();
  els.speedInput.value = String(speed);
  await sendCommand(`SPEED:${speed}`, { applyDelay: false });
}

function parseMarkdownActions(input) {
  const actions = [];
  let buffer = "";
  let i = 0;

  const flushText = () => {
    if (buffer.length > 0) {
      actions.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < input.length) {
    if (input.startsWith("***", i)) {
      flushText();
      actions.push({ type: "key", value: "CTRL+B" });
      actions.push({ type: "key", value: "CTRL+I" });
      i += 3;
      continue;
    }
    if (input.startsWith("**", i)) {
      flushText();
      actions.push({ type: "key", value: "CTRL+B" });
      i += 2;
      continue;
    }
    if (input.startsWith("__", i)) {
      flushText();
      actions.push({ type: "key", value: "CTRL+U" });
      i += 2;
      continue;
    }
    if (input[i] === "*") {
      flushText();
      actions.push({ type: "key", value: "CTRL+I" });
      i += 1;
      continue;
    }

    buffer += input[i];
    i += 1;
  }

  flushText();
  return actions;
}

async function sendActions(actions, sendToken = currentSendToken()) {
  if (!actions.length) {
    return;
  }

  const ok = await ensureConnected();
  if (!ok || !rxChar) {
    log("Not connected. Click Connect first.");
    return;
  }

  for (const action of actions) {
    if (isSendStopped(sendToken)) {
      log("Send cancelled.");
      return;
    }
    try {
      if (action.type === "text") {
        const sent = await sendTextPayload(action.value, { confirmLarge: false, sendToken });
        if (!sent) {
          return;
        }
      } else {
        await writeCommand(`KEY:${action.value}`);
      }
      const ok = await waitWithStop(40, sendToken);
      if (!ok) {
        log("Send cancelled.");
        return;
      }
    } catch (err) {
      log(`Send failed: ${err}`);
      return;
    }
  }
}

els.btnConnect.addEventListener("click", connect);
els.btnDisconnect.addEventListener("click", disconnect);
els.btnPing.addEventListener("click", () => sendCommand("PING"));
els.btnStatus.addEventListener("click", () => sendCommand("STATUS"));
els.btnStopSend.addEventListener("click", requestStopSending);

els.btnToggleSettings.addEventListener("click", () => {
  const expanded = els.settingsContent.classList.contains("is-collapsed");
  setSettingsExpanded(expanded);
  saveSettings();
});

els.btnToggleMacro.addEventListener("click", () => {
  const expanded = els.macroContent.classList.contains("is-collapsed");
  setMacroExpanded(expanded);
  saveSettings();
});

if (els.btnMacroImportJson && els.macroImportJsonFile) {
  els.btnMacroImportJson.addEventListener("click", () => {
    els.macroImportJsonFile.value = "";
    els.macroImportJsonFile.click();
  });

  els.macroImportJsonFile.addEventListener("change", async () => {
    const file = els.macroImportJsonFile.files?.[0];
    if (!file) {
      return;
    }
    try {
      await importMacroProfilesFromJsonFile(file);
      log(`\uB9E4\uD06C\uB85C JSON \uBD88\uB7EC\uC624\uAE30 \uC644\uB8CC: ${file.name}`);
    } catch (err) {
      log(`\uB9E4\uD06C\uB85C JSON \uBD88\uB7EC\uC624\uAE30 \uC2E4\uD328: ${err}`);
    } finally {
      els.macroImportJsonFile.value = "";
    }
  });
}

els.delayInput.addEventListener("change", () => {
  els.delayInput.value = String(getDelaySec());
  saveSettings();
});

els.speedInput.addEventListener("change", async () => {
  els.speedInput.value = String(getSpeedPercent());
  saveSettings();
  if (device?.gatt?.connected) {
    await applyTypingSpeed();
  }
});

els.mdMode.addEventListener("change", () => {
  saveSettings();
});

els.macroEditor.addEventListener("input", () => {
  saveSettings();
});

els.macroProfileSelect.addEventListener("change", () => {
  const picked = els.macroProfileSelect.value;
  els.macroProfileName.value = picked;
  saveSettings({ macroSelectedProfile: picked });
});

els.btnMacroAddText.addEventListener("click", () => {
  const value = els.macroTextInput.value;
  if (!value.trim()) {
    log("\uB9E4\uD06C\uB85C \uD14D\uC2A4\uD2B8 \uC785\uB825\uAC12\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    return;
  }
  const lines = value.split(/\r?\n/).map((line) => `TEXT:${line}`);
  appendMacroLines(lines);
  els.macroTextInput.value = "";
  log(`Macro add: TEXT ${lines.length} lines`);
});

els.btnMacroAddDelay.addEventListener("click", () => {
  const delayMs = getMacroDelayMs();
  els.macroDelayInput.value = String(delayMs);
  appendMacroLines([`DELAY:${delayMs}`]);
  log(`\uB9E4\uD06C\uB85C \uCD94\uAC00: DELAY:${delayMs}`);
});

els.btnMacroKeys.forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.getAttribute("data-macro-key");
    if (!key) {
      return;
    }
    appendMacroLines([`KEY:${key}`]);
    log(`\uB9E4\uD06C\uB85C \uCD94\uAC00: KEY:${key}`);
  });
});

els.btnMacroRun.addEventListener("click", runMacroScript);

els.btnMacroClear.addEventListener("click", () => {
  els.macroEditor.value = "";
  saveSettings();
});

els.btnMacroSaveProfile.addEventListener("click", () => {
  const name = normalizeMacroProfileName(els.macroProfileName.value);
  if (!name) {
    log("\uD504\uB85C\uD544 \uC774\uB984\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.");
    return;
  }
  const script = els.macroEditor.value;
  if (!script.trim()) {
    log("\uB9E4\uD06C\uB85C \uBCF8\uBB38\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    return;
  }

  const profiles = getMacroProfiles();
  const nextProfiles = { ...profiles, [name]: script };
  els.macroProfileName.value = name;
  saveSettings({ macroProfiles: nextProfiles, macroSelectedProfile: name });
  renderMacroProfileOptions(name);
  log(`\uD504\uB85C\uD544 \uC800\uC7A5: ${name}`);
});

els.btnMacroLoadProfile.addEventListener("click", () => {
  const name = normalizeMacroProfileName(els.macroProfileSelect.value || els.macroProfileName.value);
  if (!name) {
    log("\uBD88\uB7EC\uC62C \uD504\uB85C\uD544\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
    return;
  }
  const profiles = getMacroProfiles();
  if (!profiles[name]) {
    log(`\uD504\uB85C\uD544 \uC5C6\uC74C: ${name}`);
    return;
  }
  els.macroEditor.value = profiles[name];
  els.macroProfileName.value = name;
  saveSettings({ macroSelectedProfile: name });
  renderMacroProfileOptions(name);
  log(`\uD504\uB85C\uD544 \uBD88\uB7EC\uC624\uAE30: ${name}`);
});

els.btnMacroDeleteProfile.addEventListener("click", () => {
  const name = normalizeMacroProfileName(els.macroProfileSelect.value || els.macroProfileName.value);
  if (!name) {
    log("\uC0AD\uC81C\uD560 \uD504\uB85C\uD544\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
    return;
  }

  const profiles = getMacroProfiles();
  if (!profiles[name]) {
    log(`\uD504\uB85C\uD544 \uC5C6\uC74C: ${name}`);
    return;
  }

  const nextProfiles = { ...profiles };
  delete nextProfiles[name];
  saveSettings({ macroProfiles: nextProfiles, macroSelectedProfile: "" });
  renderMacroProfileOptions("");
  els.macroProfileName.value = "";
  log(`\uD504\uB85C\uD544 \uC0AD\uC81C: ${name}`);
});

els.btnSendText.addEventListener("click", async () => {
  if (isTextSending) {
    log("\uC774\uBBF8 TEXT \uC804\uC1A1\uC774 \uC9C4\uD589 \uC911\uC785\uB2C8\uB2E4.");
    return;
  }

  const text = els.textInput.value;
  const sendToken = currentSendToken();
  if (text.length === 0) {
    log("TEXT \uC804\uC1A1\uAC12\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    return;
  }

  if (shouldConfirmLargeText(text)) {
    const proceed = confirmLargeTextIfNeeded(text);
    if (!proceed) {
      log("Send cancelled: large text prompt dismissed.");
      return;
    }
  }

  isTextSending = true;
  els.btnSendText.disabled = true;
  try {
    const delayMs = getDelayMs();
    if (delayMs > 0) {
      log(`delay ${delayMs / 1000}s \uD6C4 \uC804\uC1A1`);
      const okDelay = await waitWithStop(delayMs, sendToken);
      if (!okDelay) {
        log("Send cancelled.");
        return;
      }
    }

    if (els.mdMode?.checked) {
      const actions = parseMarkdownActions(text);
      log(`\uB9C8\uD06C\uB2E4\uC6B4 \uC778\uC2DD: ${actions.length}\uAC1C \uC561\uC158 \uC804\uC1A1`);
      await sendActions(actions, sendToken);
      return;
    }

    await sendTextPayload(text, { confirmLarge: false, sendToken });
  } finally {
    isTextSending = false;
    if (device?.gatt?.connected) {
      els.btnSendText.disabled = false;
    }
  }
});

els.btnSendRaw.addEventListener("click", () => {
  const raw = els.rawInput.value.trim();
  if (!raw) {
    log("RAW \uC804\uC1A1\uAC12\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    return;
  }
  sendCommand(raw);
});

els.btnBold.addEventListener("click", () => sendCommand("KEY:CTRL+B"));
els.btnItalic.addEventListener("click", () => sendCommand("KEY:CTRL+I"));
els.btnUnderline.addEventListener("click", () => sendCommand("KEY:CTRL+U"));

els.btnKeys.forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.getAttribute("data-key");
    sendCommand(`KEY:${key}`);
  });
});

window.addEventListener("resize", resetViewport);
window.addEventListener("orientationchange", resetViewport);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    resetViewport();
  }
});

resetViewport();
applySettingsToUI();
setConnectedState(false);
log("Ready.");
tryAutoReconnect();
