import { build } from "esbuild";
export async function buildElectron() {
  await build({
    entryPoints: ["electron/main.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: "dist-electron/main.cjs",
  });
  await build({
    entryPoints: ["electron/preload.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: "dist-electron/preload.cjs",
  });
}
if (process.argv[1]?.endsWith("build-electron.ts")) await buildElectron();
