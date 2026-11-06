import express from "express";
import { homedir } from "node:os";
import path from "node:path";
import { FileStore } from "./store";
const token = process.env.XNOTE_API_TOKEN;
if (!token)
  throw new Error("XNOTE_API_TOKEN is required. Start with npm run dev.");
const base = process.env.XNOTE_HOME;
const apiPort = Number(process.env.XNOTE_API_PORT || 4318);
const webPort = Number(process.env.XNOTE_WEB_PORT || 5173);
const store = new FileStore({
  configDir: base
    ? path.join(base, "config")
    : path.join(homedir(), ".config", "xnote"),
  defaultRoot: base
    ? path.join(base, "notes")
    : path.join(homedir(), "Documents", "xnote"),
});
await store.init();
const app = express();
app.use(express.json({ limit: "16mb" }));
const methods = new Set([
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
]);
app.post("/api/:method", async (req, res) => {
  const origin = req.headers.origin;
  if (
    req.headers["x-xnote-token"] !== token ||
    (origin &&
      ![`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`].includes(
        origin,
      ))
  ) {
    res.status(403).json({ error: "访问被拒绝" });
    return;
  }
  const method = req.params.method;
  if (!methods.has(method) || !Array.isArray(req.body?.args)) {
    res.status(400).json({ error: "无效操作" });
    return;
  }
  try {
    const fn = (
      store as unknown as Record<
        string,
        (...args: unknown[]) => Promise<unknown>
      >
    )[method];
    const data = await fn.apply(store, req.body.args);
    res.json({ data: data ?? null });
  } catch (error) {
    res
      .status(400)
      .json({ error: error instanceof Error ? error.message : "文件操作失败" });
  }
});
app.listen(apiPort, "127.0.0.1", () =>
  process.stdout.write(`xnote filesystem ready on 127.0.0.1:${apiPort}\n`),
);
