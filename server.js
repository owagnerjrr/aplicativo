const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 5184);
const PUBLIC_DIR = path.join(__dirname, "public");

const state = {
  projector: { power: false, input: "HDMI 1", lamp: "Fria" },
  ac: { power: false, temperature: 22, mode: "Auto", fan: "Medio" },
  audio: { power: false, volume: 35, muted: false },
  lights: { power: true, brightness: 65 },
  screen: { position: "Recolhida" },
  lastScene: "Standby",
  activity: []
};

const scenes = {
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

const sceneNames = {
  presentation: "Apresentacao",
  meeting: "Reuniao",
  focus: "Foco",
  shutdown: "Desligar tudo"
};

function addActivity(message, details = {}) {
  state.activity.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: new Date().toISOString(),
    message,
    details
  });
  state.activity = state.activity.slice(0, 20);
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Payload muito grande"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON invalido"));
      }
    });
  });
}

function patchDevice(device, patch) {
  if (!state[device] || Array.isArray(state[device]) || typeof state[device] !== "object") {
    return false;
  }
  Object.assign(state[device], patch);
  return true;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";

    res.writeHead(200, { "content-type": type });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/device/")) {
      const device = url.pathname.split("/").pop();
      const patch = await readBody(req);
      const ok = patchDevice(device, patch);

      if (!ok) {
        sendJson(res, 404, { ok: false, error: "Dispositivo nao encontrado" });
        return;
      }

      addActivity(`Comando enviado para ${device}`, patch);
      sendJson(res, 200, { ok: true, state });
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/scene/")) {
      const scene = url.pathname.split("/").pop();
      const steps = scenes[scene];

      if (!steps) {
        sendJson(res, 404, { ok: false, error: "Cena nao encontrada" });
        return;
      }

      for (const [device, patch] of steps) {
        patchDevice(device, patch);
      }

      state.lastScene = sceneNames[scene];
      addActivity(`Cena "${sceneNames[scene]}" executada`, { scene });
      sendJson(res, 200, { ok: true, state });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Sala Control rodando em http://127.0.0.1:${PORT}`);
  console.log(`No celular, use http://IP-DO-COMPUTADOR:${PORT}`);
});
