import { contextBridge, ipcRenderer } from "electron";
import type { WindowAction } from "../src/types";
const methods = [
  "snapshot",
  "readAsset",
  "readNote",
  "createNote",
  "saveNote",
  "renameNote",
  "deleteNote",
  "createFolder",
  "renameFolder",
  "deleteFolder",
  "toggleFavorite",
  "updatePreferences",
  "changeRoot",
  "chooseDirectory",
  "openDirectory",
];
const bridge = Object.fromEntries(
  methods.map((method) => [
    method,
    async (...args: unknown[]) => {
      const result = await ipcRenderer.invoke(`xnote:${method}`, ...args);
      if (result.error) throw new Error(result.error);
      return result.data;
    },
  ]),
);
contextBridge.exposeInMainWorld("xnote", {
  ...bridge,
  ...(process.platform === "darwin"
    ? {
        windowControls: {
          perform: async (action: WindowAction) => {
            const result = await ipcRenderer.invoke(
              "xnote:windowAction",
              action,
            );
            if (result.error) throw new Error(result.error);
          },
        },
      }
    : {}),
  onBeforeClose: (handler: () => Promise<boolean>) => {
    const listener = async () =>
      ipcRenderer.send("xnote:close-ready", await handler());
    ipcRenderer.on("xnote:before-close", listener);
    return () => ipcRenderer.removeListener("xnote:before-close", listener);
  },
});
