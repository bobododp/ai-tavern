const { app, BrowserWindow, shell } = require("electron");
const net = require("net");
const path = require("path");
const { startImageProxy } = require("../image-proxy");

let mainWindow = null;
let proxyServer = null;
let proxyInfo = null;

function testPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function chooseProxyPort() {
  if (await testPort(8787)) return 8787;
  for (let port = 8788; port <= 8799; port += 1) {
    if (await testPort(port)) return port;
  }
  throw new Error("No available local proxy port between 8787 and 8799");
}

async function startLocalProxy() {
  const imageDir = path.join(app.getPath("userData"), "generated-images");
  const port = await chooseProxyPort();
  proxyInfo = await startImageProxy({
    host: "127.0.0.1",
    port,
    rootDir: app.getAppPath(),
    imageDir,
  });
  proxyServer = proxyInfo.server;
  return proxyInfo;
}

function createWindow() {
  const iconPath = path.join(app.getAppPath(), "assets", "app-icon.png");
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f4ead8",
    title: "AI酒馆",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--tavern-proxy-url=${proxyInfo.imageApiUrl}`],
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(proxyInfo.baseUrl);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  await startLocalProxy();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (proxyServer) {
    proxyServer.close();
    proxyServer = null;
  }
});
