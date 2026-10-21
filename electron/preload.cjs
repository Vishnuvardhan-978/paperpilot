/* eslint-disable @typescript-eslint/no-require-imports -- sandboxed preloads must be CommonJS */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("paperpilotSetup", {
  save: (settings) => ipcRenderer.invoke("paperpilot:save-settings", settings),
});
