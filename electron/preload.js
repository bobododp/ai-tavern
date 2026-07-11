const { contextBridge } = require("electron");

function readArg(name) {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

const imageProxyUrl = readArg("--tavern-proxy-url") || "http://127.0.0.1:8787/api/image";

contextBridge.exposeInMainWorld("tavernDesktop", {
  imageProxyUrl,
});
