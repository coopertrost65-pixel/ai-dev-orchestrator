const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const { createWriteStream, existsSync } = require("node:fs");
const { mkdir, readFile, realpath, writeFile } = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const APP_NAME = "AI Dev Orchestrator";
const STARTUP_TIMEOUT_MS = 30_000;
const DOCK_ANIMATION_FRAME_COUNT = 20;
const DOCK_ANIMATION_FRAME_MS = 80;

let mainWindow = null;
let serverProcess = null;
let localOrigin = null;
let isQuitting = false;
let dockAnimationTimer = null;

app.setName(APP_NAME);
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: app.getVersion(),
  copyright: "Private local app",
});

function stopDockIconAnimation() {
  if (dockAnimationTimer) clearTimeout(dockAnimationTimer);
  dockAnimationTimer = null;
}

function animateDockIconOnce() {
  if (process.platform !== "darwin" || !app.dock) return;
  const frameDirectory = path.join(app.getAppPath(), "desktop", "assets", "dock-animation");
  const frames = Array.from({ length: DOCK_ANIMATION_FRAME_COUNT }, (_, index) => (
    path.join(frameDirectory, `frame-${String(index).padStart(2, "0")}.png`)
  ));
  if (frames.some((frame) => !existsSync(frame))) return;

  let frameIndex = 0;
  const showNextFrame = () => {
    if (isQuitting || frameIndex >= frames.length) {
      dockAnimationTimer = setTimeout(() => stopDockIconAnimation(), 160);
      return;
    }
    app.dock.setIcon(frames[frameIndex]);
    frameIndex += 1;
    dockAnimationTimer = setTimeout(showNextFrame, DOCK_ANIMATION_FRAME_MS);
  };
  showNextFrame();
}

function getServerDirectory() {
  return app.isPackaged
    ? path.join(app.getAppPath(), "server")
    : path.join(app.getAppPath(), "dist", "standalone");
}

function findExecutable(name, preferred = []) {
  const candidates = [
    ...preferred,
    ...String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, name)),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "";
}

function getAllowedRootsFile() {
  return path.join(app.getPath("userData"), "permissions", "allowed-project-roots.json");
}

async function rememberAllowedRoot(folderPath) {
  const filePath = getAllowedRootsFile();
  const resolved = await realpath(folderPath);
  let current = [];
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (Array.isArray(parsed)) current = parsed.filter((item) => typeof item === "string");
  } catch {
    // The permission list is created on first use; malformed content is replaced.
  }
  const next = Array.from(new Set([...current, resolved]));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return resolved;
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("Could not reserve a private local port.")));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

function waitForServer(origin) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!serverProcess || serverProcess.exitCode !== null) {
        reject(new Error("The private local engine stopped during startup."));
        return;
      }

      const request = http.get(origin, (response) => {
        response.resume();
        resolve();
      });
      request.setTimeout(1_000, () => request.destroy());
      request.once("error", () => {
        if (Date.now() - startedAt >= STARTUP_TIMEOUT_MS) {
          reject(new Error("The private local engine took too long to start."));
          return;
        }
        setTimeout(check, 180);
      });
    };
    check();
  });
}

async function startLocalServer() {
  const serverDirectory = getServerDirectory();
  const serverEntry = path.join(serverDirectory, "server.js");
  const userDataDirectory = app.getPath("userData");
  const stateFile = path.join(userDataDirectory, "state", "orchestrator-state.json");
  const logDirectory = path.join(userDataDirectory, "logs");
  const port = await findOpenPort();
  localOrigin = `http://127.0.0.1:${port}`;

  await mkdir(logDirectory, { recursive: true });
  const logStream = createWriteStream(path.join(logDirectory, "desktop-server.log"), { flags: "a" });

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      AI_DEV_ORCHESTRATOR_STATE_FILE: stateFile,
      AI_DEV_ORCHESTRATOR_USAGE_FILE: path.join(userDataDirectory, "state", "provider-usage.json"),
      AI_DEV_ORCHESTRATOR_ALLOWED_ROOTS_FILE: getAllowedRootsFile(),
      AI_DEV_ORCHESTRATOR_DESKTOP: "1",
      AI_DEV_ORCHESTRATOR_CHATGPT_MEMORY_ROOT: path.join(app.getPath("home"), "Documents", "ChatGPT Memory"),
      AI_DEV_ORCHESTRATOR_CLAUDE_MEMORY_ROOT: path.join(app.getPath("home"), "Documents", "Claude Memory"),
      AI_DEV_ORCHESTRATOR_CODEX_PATH: findExecutable("codex", ["/Applications/ChatGPT.app/Contents/Resources/codex"]),
      AI_DEV_ORCHESTRATOR_CLAUDE_PATH: findExecutable("claude", [
        path.join(app.getPath("home"), ".local", "bin", "claude"),
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
      ]),
      ELECTRON_RUN_AS_NODE: "1",
      HOST: "127.0.0.1",
      PORT: String(port),
      WRANGLER_WRITE_LOGS: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.pipe(logStream, { end: false });
  serverProcess.stderr.pipe(logStream, { end: false });
  serverProcess.once("exit", (code, signal) => {
    logStream.write(`\n[desktop] Server exited: code=${code ?? "none"} signal=${signal ?? "none"}\n`);
    logStream.end();
  });

  await waitForServer(localOrigin);
  return localOrigin;
}

function loadingPage(message, detail = "Starting your private local workspace…") {
  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <style>
    :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0a0b10;color:#eef0f8}
    *{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;background:radial-gradient(circle at 50% 35%,#191b26 0,#0a0b10 54%)}
    main{text-align:center;padding:32px}.mark{display:grid;grid-template-columns:1fr 1fr;gap:5px;width:64px;height:64px;margin:0 auto 24px;padding:14px;border-radius:17px;background:#24231e;box-shadow:0 18px 50px #0008}
    .mark i:first-child{background:#7c86f2}.mark i:last-child{background:#eef0f8}h1{font-size:21px;margin:0 0 8px;font-weight:650}p{color:#a9adc4;margin:0;font-size:14px}.pulse{animation:p 1.25s ease-in-out infinite}@keyframes p{50%{opacity:.48}}
  </style></head><body><main><div class="mark pulse"><i></i><i></i></div><h1>${message}</h1><p>${detail}</p></main></body></html>`;
}

function showHtml(html) {
  return mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }] },
  ]));
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: "#0a0b10",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(app.getAppPath(), "desktop", "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (localOrigin && url.startsWith(localOrigin)) return;
    if (url.startsWith("data:text/html")) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
  });

  await showHtml(loadingPage(APP_NAME));
  try {
    const origin = await startLocalServer();
    await mainWindow.loadURL(origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup error.";
    await showHtml(loadingPage("The app could not start", message));
  }
}

function stopLocalServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill("SIGTERM");
  serverProcess = null;
}

app.on("before-quit", () => {
  isQuitting = true;
  stopDockIconAnimation();
  stopLocalServer();
});
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (!isQuitting && BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});

app.whenReady().then(async () => {
  installMenu();
  animateDockIconOnce();
  ipcMain.handle("orchestrator:select-project-folder", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a coding project folder",
      buttonLabel: "Use this folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return rememberAllowedRoot(result.filePaths[0]);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  await createMainWindow();
});
