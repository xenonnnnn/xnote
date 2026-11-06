import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
const env = {
  ...process.env,
  XNOTE_API_TOKEN: randomBytes(32).toString("hex"),
};
const webURL = `http://127.0.0.1:${process.env.XNOTE_WEB_PORT || 5173}`;
const children: ChildProcess[] = [];
function start(command: string, args: string[], childEnv = env) {
  const child = spawn(command, args, { stdio: "inherit", env: childEnv });
  children.push(child);
  child.on("exit", (code) => {
    if (code) stop(code);
  });
  return child;
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill("SIGTERM"));
  setTimeout(() => process.exit(code), 200).unref();
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
start("node", ["--import", "tsx", "server/index.ts"]);
start("node", ["node_modules/vite/bin/vite.js"]);
if (process.argv.includes("--desktop")) {
  const { buildElectron } = await import("./build-electron");
  await buildElectron();
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const r = await fetch(webURL);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const desktopEnv = { ...env, XNOTE_DEV_URL: webURL };
  delete (desktopEnv as Record<string, string | undefined>)
    .ELECTRON_RUN_AS_NODE;
  const desktop = start(
    "node",
    ["node_modules/electron/cli.js", "."],
    desktopEnv,
  );
  desktop.on("exit", () => stop());
}
