const stateUrl = "/api/state";
let currentState = null;
let toastTimer = null;

const formatPower = (value) => (value ? "Ligado" : "Desligado");

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options
  });

  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Falha ao enviar comando");
  }
  return data;
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

loadState().catch((error) => showToast(error.message));
