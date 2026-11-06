import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promises as fs } from "node:fs";
import { FileStore } from "../server/store";
let window: BrowserWindow;
let closing = false;
let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});
const devURL = process.env.XNOTE_DEV_URL;
const channels = [
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
] as const;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    const base = process.env.XNOTE_HOME;
    const configDir = base
      ? path.join(base, "config")
      : app.getPath("userData");
    const store = new FileStore({
      configDir,
      defaultRoot: base
        ? path.join(base, "notes")
        : path.join(app.getPath("documents"), "xnote"),
    });
    try {
      await store.init();
    } catch (error) {
      dialog.showErrorBox("无法打开笔记目录", String(error));
      app.quit();
      return;
    }
    const boundsFile = path.join(configDir, "window.json");
    let bounds: { width: number; height: number; x?: number; y?: number } = {
      width: 1020,
      height: 700,
    };
    try {
      const saved = JSON.parse(await fs.readFile(boundsFile, "utf8"));
      if (Number.isFinite(saved.width) && Number.isFinite(saved.height))
        bounds = {
          width: Math.max(860, saved.width),
          height: Math.max(600, saved.height),
          x: saved.x,
          y: saved.y,
        };
    } catch {}
    const localURL = pathToFileURL(
      path.join(__dirname, "../dist/index.html"),
    ).href;
    const allowedURL = (url: string) =>
      devURL ? url.startsWith(`${devURL}/`) : url.split("#")[0] === localURL;
    const trusted = (
      event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
    ) =>
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      allowedURL(event.senderFrame.url);
    for (const method of channels)
      ipcMain.handle(`xnote:${method}`, async (event, ...args) => {
        if (!trusted(event)) return { error: "访问被拒绝" };
        try {
          return {
            data: await (
              store[method] as (...args: unknown[]) => Promise<unknown>
            ).apply(store, args),
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
    ipcMain.handle("xnote:chooseDirectory", async (event) => {
      if (!trusted(event)) return { error: "访问被拒绝" };
      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory", "createDirectory"],
        title: "选择笔记保存目录",
      });
      return { data: result.canceled ? null : result.filePaths[0] };
    });
    ipcMain.handle("xnote:openDirectory", async (event) => {
      if (!trusted(event)) return { error: "访问被拒绝" };
      try {
        const result = await shell.openPath(
          (await store.snapshot()).config.root,
        );
        return result ? { error: result } : { data: null };
      } catch (error) {
        return { error: String(error) };
      }
    });
    ipcMain.handle("xnote:windowAction", (event, action: unknown) => {
      if (!trusted(event) || process.platform !== "darwin")
        return { error: "访问被拒绝" };
      switch (action) {
        case "close":
          window.close();
          break;
        case "minimize":
          window.minimize();
          break;
        case "fullscreen":
          window.setFullScreen(!window.isFullScreen());
          break;
        case "zoom":
          if (window.isMaximized()) window.unmaximize();
          else window.maximize();
          break;
        default:
          return { error: "不支持的窗口操作" };
      }
      return { data: null };
    });
    const createWindow = async () => {
      closing = false;
      window = new BrowserWindow({
        ...bounds,
        minWidth: 860,
        minHeight: 600,
        title: "xnote",
        backgroundColor: "#f8f7f5",
        titleBarStyle: process.platform === "darwin" ? "hidden" : "hiddenInset",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      if (process.platform === "darwin") window.setWindowButtonVisibility(false);
      window.webContents.on("will-prevent-unload", (event) => {
        if (closing) event.preventDefault();
      });
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        if (!allowedURL(url)) event.preventDefault();
      });
      window.on("close", (event) => {
        if (!closing) {
          event.preventDefault();
          window.webContents.send("xnote:before-close");
        }
      });
      window.on("closed", () => {
        if (process.platform !== "darwin") app.quit();
      });
      if (devURL) await window.loadURL(devURL);
      else await window.loadFile(path.join(__dirname, "../dist/index.html"));
    };
    ipcMain.on("xnote:close-ready", async (event, ready) => {
      if (!trusted(event)) return;
      if (!ready) {
        const result = await dialog.showMessageBox(window, {
          type: "warning",
          message: "笔记尚未保存，仍要退出吗？",
          detail:
            "退出会丢失未保存的修改。你可以返回编辑器，复制内容或重试保存。",
          buttons: ["返回编辑器", "放弃修改并退出"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 0) return;
      }
      bounds = window.getBounds();
      await fs.writeFile(boundsFile, JSON.stringify(bounds)).catch(() => {});
      closing = true;
      window.close();
      if (quitting) app.quit();
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "xnote",
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "quit" },
          ],
        },
        {
          label: "编辑",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        { label: "窗口", submenu: [{ role: "minimize" }, { role: "zoom" }] },
      ]),
    );
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
