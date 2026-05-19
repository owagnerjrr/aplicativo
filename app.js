const stateUrl = "/api/state";
let currentState = null;
let toastTimer = null;
let demoMode = window.location.hostname.endsWith("github.io");
let addedDevices = loadAddedDevices();

const demoState = {
  projector: { power: false, input: "HDMI 1", lamp: "Fria" },
  ac: { power: false, temperature: 22, mode: "Auto", fan: "Medio" },
  audio: { power: false, volume: 35, muted: false },
  lights: { power: true, brightness: 65 },
  screen: { position: "Recolhida" },
  lastScene: "Standby",
  activity: []
};

const demoScenes = {
  presentation: [
    ["projector", { power: true, input: "HDMI 1" }],
    ["ac", { power: true, temperature: 22, mode: "Frio" }],
    ["audio", { power: true, volume: 42, muted: false }],
    ["lights", { power: true, brightness: 35 }],
    ["screen", { position: "Baixada" }]
  ],
  meeting: [
    ["projector", { power: true, input: "Wireless" }],
    ["ac", { power: true, temperature: 23, mode: "Auto" }],
    ["audio", { power: true, volume: 28, muted: false }],
    ["lights", { power: true, brightness: 70 }],
    ["screen", { position: "Baixada" }]
  ],
  focus: [
    ["projector", { power: false }],
    ["ac", { power: true, temperature: 21, mode: "Frio" }],
    ["audio", { power: false }],
    ["lights", { power: true, brightness: 90 }],
    ["screen", { position: "Recolhida" }]
  ],
  shutdown: [
    ["projector", { power: false }],
    ["ac", { power: false }],
    ["audio", { power: false, muted: false }],
    ["lights", { power: false, brightness: 0 }],
    ["screen", { position: "Recolhida" }]
  ]
};

const demoSceneNames = {
  presentation: "Apresentacao",
  meeting: "Reuniao",
  focus: "Foco",
  shutdown: "Desligar tudo"
};

const discoveredDevices = [];
const remoteCatalog = [
  {
    name: "Controle Hitachi",
    type: "Ar condicionado",
    group: "clima",
    tech: "ir",
    status: "Controle infravermelho",
    detail: "Use o infravermelho do celular ou um hub compativel.",
    connection: "hub",
    source: "remote"
  }
];

const techNames = {
  ip: "Wi-Fi/IP",
  bluetooth: "Bluetooth",
  ir: "Infravermelho",
  rf: "RF",
  zigbee: "Zigbee",
  zwave: "Z-Wave",
  cec: "HDMI-CEC",
  serial: "Serial/RS-232",
  nfc: "NFC/QR"
};

const controlProfiles = {
  ip: { action: "Abrir controle", control: "Entrada" },
  bluetooth: { action: "Conectar", control: "Volume" },
  ir: { action: "Aprender controle", control: "Power" },
  rf: { action: "Parear RF", control: "Acionamento" },
  zigbee: { action: "Parear hub", control: "Intensidade" },
  zwave: { action: "Parear hub", control: "Liga/desliga" },
  cec: { action: "Detectar HDMI", control: "Fonte" },
  serial: { action: "Configurar porta", control: "Comando" },
  nfc: { action: "Ler etiqueta", control: "Cadastro" }
};

const formatPower = (value) => (value ? "Ligado" : "Desligado");
const clone = (value) => JSON.parse(JSON.stringify(value));

function loadAddedDevices() {
  try {
    return JSON.parse(localStorage.getItem("salaControlDevices") || "[]");
  } catch {
    return [];
  }
}

function saveAddedDevices() {
  localStorage.setItem("salaControlDevices", JSON.stringify(addedDevices));
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

async function request(url, options = {}) {
  if (demoMode) {
    return demoRequest(url, options);
  }

  try {
    const response = await fetch(url, {
      headers: { "content-type": "application/json" },
      ...options
    });

    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "Falha ao enviar comando");
    }
    return data;
  } catch (error) {
    demoMode = true;
    showToast("Modo demo ativo");
    return demoRequest(url, options);
  }
}

async function demoRequest(url, options = {}) {
  if (url === stateUrl) {
    return clone(demoState);
  }

  if (url.startsWith("/api/device/")) {
    const device = url.split("/").pop();
    const patch = options.body ? JSON.parse(options.body) : {};

    if (!demoState[device]) {
      throw new Error("Dispositivo nao encontrado");
    }

    Object.assign(demoState[device], patch);
    addDemoActivity(`Comando enviado para ${device}`, patch);
    return { ok: true, state: clone(demoState) };
  }

  if (url.startsWith("/api/scene/")) {
    const scene = url.split("/").pop();
    const steps = demoScenes[scene];

    if (!steps) {
      throw new Error("Cena nao encontrada");
    }

    steps.forEach(([device, patch]) => Object.assign(demoState[device], patch));
    demoState.lastScene = demoSceneNames[scene];
    addDemoActivity(`Cena "${demoSceneNames[scene]}" executada`, { scene });
    return { ok: true, state: clone(demoState) };
  }

  throw new Error("Rota nao encontrada");
}

function addDemoActivity(message, details = {}) {
  demoState.activity.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: new Date().toISOString(),
    message,
    details
  });
  demoState.activity = demoState.activity.slice(0, 20);
}

async function loadState() {
  currentState = await request(stateUrl);
  render(currentState);
}

async function patchDevice(device, patch) {
  const data = await request(`/api/device/${device}`, {
    method: "POST",
    body: JSON.stringify(patch)
  });
  currentState = data.state;
  render(currentState);
}

async function runScene(scene) {
  const data = await request(`/api/scene/${scene}`, { method: "POST" });
  currentState = data.state;
  render(currentState);
  showToast("Cena executada");
}

function render(state) {
  document.querySelector("#last-scene").textContent = state.lastScene;

  const activeCount = ["projector", "ac", "audio", "lights"].filter((device) => state[device].power).length;
  document.querySelector("#room-status").textContent = `${activeCount} equipamentos ativos`;

  renderDevice("projector", state.projector, (device) =>
    `${formatPower(device.power)} · ${device.input}`
  );

  renderDevice("ac", state.ac, (device) =>
    `${formatPower(device.power)} · ${device.temperature}°C · ${device.mode}`
  );

  renderDevice("audio", state.audio, (device) =>
    `${formatPower(device.power)} · ${device.volume}%${device.muted ? " · mudo" : ""}`
  );

  renderDevice("lights", state.lights, (device) =>
    `${formatPower(device.power)} · ${device.brightness}%`
  );

  renderDevice("screen", state.screen, (device) => device.position);
  renderAddedDevices();
  renderActivity(state.activity);
}

function renderDevice(deviceName, deviceState, summaryFactory) {
  const card = document.querySelector(`[data-device="${deviceName}"]`);
  if (!card) return;

  card.querySelector("[data-summary]").textContent = summaryFactory(deviceState);

  card.querySelectorAll("[data-field]").forEach((input) => {
    const field = input.dataset.field;
    if (!(field in deviceState)) return;

    if (input.classList.contains("toggle")) {
      input.textContent = deviceState[field] ? "Desligar" : "Ligar";
      input.classList.toggle("is-on", Boolean(deviceState[field]));
      return;
    }

    input.value = deviceState[field];
  });

  card.querySelectorAll("[data-value]").forEach((value) => {
    const field = value.dataset.value;
    const suffix = field === "temperature" ? "°C" : "%";
    value.textContent = `${deviceState[field]}${suffix}`;
  });

  card.querySelectorAll("[data-position]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.position === deviceState.position);
  });
}

function renderActivity(activity) {
  const log = document.querySelector("#activity-log");

  if (!activity.length) {
    log.innerHTML = "<li>Nenhum comando enviado ainda.</li>";
    return;
  }

  log.innerHTML = activity
    .map((item) => {
      const time = new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date(item.time));
      return `<li><strong>${time}</strong> · ${item.message}</li>`;
    })
    .join("");
}

function renderAddedDevices() {
  const container = document.querySelector("#added-devices");
  if (!container) return;

  container.innerHTML = addedDevices
    .map((device) => {
      const profile = controlProfiles[device.tech] || controlProfiles.ip;
      const valueLabel = device.tech === "bluetooth" ? `${device.level}%` : device.level;
      const range =
        device.tech === "bluetooth" || device.tech === "zigbee"
          ? `
            <label>
              ${profile.control}
              <input type="range" min="0" max="100" step="5" data-added-range="${device.id}" value="${device.level}" />
              <strong>${valueLabel}</strong>
            </label>
          `
          : "";

      return `
        <article class="device-card discovered-card" data-added-card="${device.id}">
          <div class="card-header">
            <div>
              <span class="device-icon">+</span>
              <h3>${device.name}</h3>
            </div>
            <button class="toggle ${device.power ? "is-on" : ""}" data-added-power="${device.id}">
              ${device.power ? "Desligar" : "Ligar"}
            </button>
          </div>
          <span class="tech-pill">${techNames[device.tech]}</span>
          ${range}
          <button class="secondary" data-added-action="${device.id}">${profile.action}</button>
          <p class="device-state">${formatPower(device.power)} - ${device.type} - ${device.status}</p>
        </article>
      `;
    })
    .join("");
}

document.querySelectorAll("[data-scene]").forEach((button) => {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await runScene(button.dataset.scene);
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });
});

document.querySelectorAll(".device-card").forEach((card) => {
  const device = card.dataset.device;

  card.querySelectorAll("[data-field]").forEach((control) => {
    const eventName = control.classList.contains("toggle") ? "click" : "change";

    control.addEventListener(eventName, async () => {
      const field = control.dataset.field;
      const rawValue = control.classList.contains("toggle")
        ? !currentState[device][field]
        : control.value;
      const value = control.type === "range" ? Number(rawValue) : rawValue;

      try {
        await patchDevice(device, { [field]: value });
        showToast("Comando enviado");
      } catch (error) {
        showToast(error.message);
      }
    });

    if (control.type === "range") {
      control.addEventListener("input", () => {
        const value = card.querySelector(`[data-value="${control.dataset.field}"]`);
        const suffix = control.dataset.field === "temperature" ? "°C" : "%";
        value.textContent = `${control.value}${suffix}`;
      });
    }
  });

  card.querySelectorAll("[data-position]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await patchDevice(device, { position: button.dataset.position });
        showToast("Tela atualizada");
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  const muteButton = card.querySelector("[data-action='mute']");
  if (muteButton) {
    muteButton.addEventListener("click", async () => {
      try {
        await patchDevice(device, { muted: !currentState[device].muted });
        showToast("Audio atualizado");
      } catch (error) {
        showToast(error.message);
      }
    });
  }
});

document.querySelector("#refresh").addEventListener("click", async () => {
  try {
    await loadState();
    showToast("Estado atualizado");
  } catch (error) {
    showToast(error.message);
  }
});

const discoverDialog = document.querySelector("#discover-dialog");
const discoverOpen = document.querySelector("#discover-open");
const welcomeSearch = document.querySelector("#welcome-search");
const discoverScan = document.querySelector("#discover-scan");
const discoverQuery = document.querySelector("#discover-query");
const discoverTech = document.querySelector("#discover-tech");
const discoverResults = document.querySelector("#discover-results");
const connectStatus = document.querySelector("#connect-status");

function setConnectStatus(message, tone = "info") {
  connectStatus.hidden = false;
  connectStatus.textContent = message;
  connectStatus.dataset.tone = tone;
}

function clearConnectStatus() {
  connectStatus.hidden = true;
  connectStatus.textContent = "";
}

function renderDiscoverResults(items = discoveredDevices) {
  if (!items.length) {
    discoverResults.innerHTML = `
      <div class="empty-state">
        <strong>Nenhum equipamento encontrado</strong>
        <span>Pesquise pela marca para procurar controles compativeis.</span>
      </div>
    `;
    return;
  }

  discoverResults.innerHTML = items
    .map(
      (item) => `
        <article class="result-card">
          <div>
            <h3>${item.name}</h3>
            <p>${item.type}${item.source === "remote" ? " - controle compativel" : ""}</p>
          </div>
          <div class="result-actions">
            <button type="button" data-add-device="${item.name}">
              ${addedDevices.some((device) => device.name === item.name) ? "Conectado" : "Conectar"}
            </button>
          </div>
        </article>
      `
    )
    .join("");
}

function showSearching() {
  clearConnectStatus();
  discoverResults.innerHTML = `
    <div class="searching-state">
      <div class="spinner"></div>
      <strong>Procurando equipamentos...</strong>
    </div>
  `;
}

async function detectDevices() {
  return [];
}

function searchRemoteCatalog(query, group) {
  if (!query) return [];

  return remoteCatalog.filter((item) => {
    const matchesGroup = group === "all" || item.group === group;
    const text = `${item.name} ${item.type} ${item.detail}`.toLowerCase();
    return matchesGroup && text.includes(query);
  });
}

async function scanDevices() {
  const query = discoverQuery.value.trim().toLowerCase();
  const group = discoverTech.value;
  showSearching();

  const detected = await detectDevices();
  discoveredDevices.splice(0, discoveredDevices.length, ...detected);

  const foundDevices = discoveredDevices.filter((item) => {
    const matchesGroup = group === "all" || item.group === group;
    const text = `${item.name} ${item.type}`.toLowerCase();
    return matchesGroup && (!query || text.includes(query));
  });
  const compatibleRemotes = searchRemoteCatalog(query, group);
  const results = [...foundDevices, ...compatibleRemotes];

  renderDiscoverResults(results);
  showToast("Busca concluida");
}

function openDiscovery({ searching = true } = {}) {
  clearConnectStatus();
  discoverQuery.value = "";
  discoverTech.value = "all";

  if (typeof discoverDialog.showModal === "function") {
    discoverDialog.showModal();
  } else {
    discoverDialog.setAttribute("open", "");
  }

  if (searching) {
    setTimeout(scanDevices, 750);
  } else {
    renderDiscoverResults();
  }
}

discoverOpen.addEventListener("click", () => {
  openDiscovery();
});

welcomeSearch.addEventListener("click", () => openDiscovery());

discoverScan.addEventListener("click", scanDevices);
discoverQuery.addEventListener("input", () => {
  clearConnectStatus();
  scanDevices();
});
discoverTech.addEventListener("change", () => {
  clearConnectStatus();
  scanDevices();
});

async function connectDiscoveredDevice(item) {
  setConnectStatus(`Conectando ${item.name}...`);
  await new Promise((resolve) => setTimeout(resolve, 650));

  if (item.connection === "hub") {
    setConnectStatus("Este controle precisa de infravermelho no celular ou hub.", "warn");
    showToast("Precisa de hub");
    return false;
  }

  if (item.connection === "permission") {
    setConnectStatus("Permissao solicitada. Conectado em modo teste.", "ok");
  } else {
    setConnectStatus("Conectado com sucesso.", "ok");
  }

  return true;
}

discoverResults.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-add-device]");
  if (!button) return;

  const item = [...discoveredDevices, ...remoteCatalog].find((candidate) => candidate.name === button.dataset.addDevice);
  if (!item) return;
  if (addedDevices.some((device) => device.name === item.name)) {
    setConnectStatus("Este equipamento ja esta conectado.", "ok");
    return;
  }

  button.disabled = true;
  const connected = await connectDiscoveredDevice(item);
  button.disabled = false;

  if (!connected) return;

  addedDevices.push({
    ...item,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    power: false,
    level: item.tech === "bluetooth" ? 35 : 65
  });
  saveAddedDevices();
  document.body.classList.remove("is-first-run");
  localStorage.setItem("salaControlSeen", "true");
  addDemoActivity(`Equipamento adicionado: ${item.name}`, { tech: item.tech });
  renderAddedDevices();
  scanDevices();
  renderActivity(demoState.activity);
  showToast("Conectado");
});

document.querySelector("#added-devices").addEventListener("click", (event) => {
  const powerButton = event.target.closest("[data-added-power]");
  const actionButton = event.target.closest("[data-added-action]");

  if (powerButton) {
    const device = addedDevices.find((item) => item.id === powerButton.dataset.addedPower);
    if (!device) return;
    device.power = !device.power;
    saveAddedDevices();
    addDemoActivity(`Comando enviado para ${device.name}`, { power: device.power });
    renderAddedDevices();
    renderActivity(demoState.activity);
    showToast("Comando enviado");
  }

  if (actionButton) {
    const device = addedDevices.find((item) => item.id === actionButton.dataset.addedAction);
    if (!device) return;
    addDemoActivity(`Configuracao aberta: ${device.name}`, { tech: device.tech });
    renderActivity(demoState.activity);
    showToast(controlProfiles[device.tech].action);
  }
});

document.querySelector("#added-devices").addEventListener("change", (event) => {
  const slider = event.target.closest("[data-added-range]");
  if (!slider) return;
  const device = addedDevices.find((item) => item.id === slider.dataset.addedRange);
  if (!device) return;
  device.level = Number(slider.value);
  saveAddedDevices();
  renderAddedDevices();
});

loadState()
  .then(() => {
    if (!addedDevices.length && !localStorage.getItem("salaControlSeen")) {
      document.body.classList.add("is-first-run");
    }
  })
  .catch((error) => showToast(error.message));
