const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiDevOrchestrator", {
  selectProjectFolder: () => ipcRenderer.invoke("orchestrator:select-project-folder"),
});
