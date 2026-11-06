import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  symlink,
  rm,
  rename,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const injectedWriter = vi.hoisted(() => ({
  target: "",
  afterRename: false,
  afterLink: false,
}));
// Real files remain in use; only the timing of a second editor's write is injected.
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    rename: async (
      source: Parameters<typeof original.rename>[0],
      target: Parameters<typeof original.rename>[1],
    ) => {
      await original.rename(source, target);
      if (injectedWriter.afterRename && target === injectedWriter.target) {
        injectedWriter.afterRename = false;
        await original.writeFile(target, "unseen external update");
      }
    },
    link: async (
      source: Parameters<typeof original.link>[0],
      target: Parameters<typeof original.link>[1],
    ) => {
      await original.link(source, target);
      if (injectedWriter.afterLink && target === injectedWriter.target) {
        injectedWriter.afterLink = false;
        await original.writeFile(target, "unseen external update");
      }
    },
  };
});
import { FileStore } from "../server/store";

let base: string;
let root: string;
let store: FileStore;
beforeEach(async () => {
  Object.assign(injectedWriter, {
    target: "",
    afterRename: false,
    afterLink: false,
  });
  base = await realpath(await mkdtemp(join(tmpdir(), "xnote-store-")));
  root = join(base, "notes");
  store = new FileStore({ configDir: join(base, "config"), defaultRoot: root });
  await store.init();
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("real local note files", () => {
  it("migrates the saved 220px sidebar once and preserves later user resizing", async () => {
    const configPath = join(base, "config", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    delete config.layoutVersion;
    config.preferences.sidebarWidth = 220;
    await writeFile(configPath, JSON.stringify(config));
    const restart = () =>
      new FileStore({ configDir: join(base, "config"), defaultRoot: root });
    const migrated = restart();
    await migrated.init();
    expect((await migrated.snapshot()).config.preferences.sidebarWidth).toBe(
      200,
    );
    expect(
      JSON.parse(await readFile(configPath, "utf8")).preferences.sidebarWidth,
    ).toBe(200);
    await migrated.updatePreferences({ sidebarWidth: 220 });
    const resized = restart();
    await resized.init();
    expect((await resized.snapshot()).config.preferences.sidebarWidth).toBe(
      220,
    );
  });

  it("preserves a custom sidebar width when migrating older configuration", async () => {
    const configPath = join(base, "config", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    delete config.layoutVersion;
    config.preferences.sidebarWidth = 260;
    await writeFile(configPath, JSON.stringify(config));
    const reopened = new FileStore({
      configDir: join(base, "config"),
      defaultRoot: root,
    });
    await reopened.init();
    expect((await reopened.snapshot()).config.preferences.sidebarWidth).toBe(
      260,
    );
  });

  it("acknowledges only the body it wrote when another editor writes immediately afterward", async () => {
    const note = await store.createNote("md");
    injectedWriter.target = join(root, note.path);
    injectedWriter.afterRename = true;
    const saved = await store.saveNote(note.path, "app draft", note.revision);
    expect(saved.content).toBe("app draft");
    expect(await readFile(join(root, note.path), "utf8")).toBe(
      "unseen external update",
    );
    await expect(
      store.saveNote(note.path, "next app edit", saved.revision),
    ).rejects.toThrow("CONFLICT:");
  });
  it("keeps the known content revision and new path when another editor writes during rename", async () => {
    const created = await store.createNote("md");
    const note = await store.saveNote(
      created.path,
      "known app content",
      created.revision,
    );
    injectedWriter.target = join(root, "renamed.md");
    injectedWriter.afterLink = true;
    const renamed = await store.renameNote(note.path, "renamed", note.revision);
    expect(renamed.path).toBe("renamed.md");
    expect(renamed.content).toBe("known app content");
    expect(renamed.revision).toBe(note.revision);
    expect(await readFile(join(root, renamed.path), "utf8")).toBe(
      "unseen external update",
    );
    await expect(
      store.saveNote(renamed.path, "next app edit", renamed.revision),
    ).rejects.toThrow("CONFLICT:");
  });

  it("creates unique plain files, saves UTF-8 and survives restart", async () => {
    const first = await store.createNote("md");
    expect(first.path).toBe("Untitled.md");
    expect((await store.createNote("md")).path).toBe("Untitled 2.md");
    expect((await store.createNote("txt")).path).toBe("Untitled.txt");
    const saved = await store.saveNote(
      first.path,
      "# 你好\n真实笔记",
      first.revision,
    );
    expect(await readFile(join(root, first.path), "utf8")).toBe(saved.content);
    const next = new FileStore({
      configDir: join(base, "config"),
      defaultRoot: join(base, "ignored"),
    });
    await next.init();
    expect((await next.snapshot()).notes).toHaveLength(3);
    expect((await next.readNote(first.path)).content).toContain("真实笔记");
  });
  it("reads existing platform-valid filenames without applying new-name restrictions", async () => {
    await writeFile(join(root, "Meeting: notes.md"), "existing");
    expect((await store.readNote("Meeting: notes.md")).content).toBe(
      "existing",
    );
  });
  it("skips occupied default names even if they are directories or symlinks", async () => {
    await mkdir(join(root, "Untitled.md"));
    await symlink(base, join(root, "Untitled 2.md"));
    expect((await store.createNote("md")).path).toBe("Untitled 3.md");
  });
  it("serializes simultaneous creates without overwriting", async () => {
    const notes = await Promise.all(
      Array.from({ length: 12 }, () => store.createNote("md")),
    );
    expect(new Set(notes.map((n) => n.path)).size).toBe(12);
    expect(await readdir(root)).toHaveLength(12);
  });
  it("rejects a second simultaneous save from the same old revision", async () => {
    const note = await store.createNote("md");
    const results = await Promise.allSettled([
      store.saveNote(note.path, "first", note.revision),
      store.saveNote(note.path, "second", note.revision),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(await readFile(join(root, note.path), "utf8")).toBe("first");
    expect(
      (await readdir(root)).filter((name) => name.startsWith(".xnote-")),
    ).toEqual([]);
  });
  it("detects external changes and rejects stale saves, renames, and deletes", async () => {
    const note = await store.createNote("md");
    await writeFile(join(root, note.path), "external edit");
    await expect(
      store.saveNote(note.path, "old draft", note.revision),
    ).rejects.toThrow("CONFLICT:");
    await expect(
      store.renameNote(note.path, "renamed", note.revision),
    ).rejects.toThrow("CONFLICT:");
    await expect(store.deleteNote(note.path, note.revision)).rejects.toThrow(
      "CONFLICT:",
    );
    expect((await store.snapshot()).notes[0].content).toBe("external edit");
    expect(await readFile(join(root, note.path), "utf8")).toBe("external edit");
  });
  it("never recreates an externally deleted note from a stale save", async () => {
    const note = await store.createNote("txt");
    await rm(join(root, note.path));
    await expect(
      store.saveNote(note.path, "draft", note.revision),
    ).rejects.toThrow("CONFLICT:");
    expect(await readdir(root)).toHaveLength(0);
  });
  it("preserves markdown extension and refuses duplicate rename targets", async () => {
    await writeFile(join(root, "手记.markdown"), "**hello**");
    const note = await store.readNote("手记.markdown");
    const named = await store.renameNote(note.path, "生活", note.revision);
    expect(named.path).toBe("生活.markdown");
    await writeFile(join(root, "目标.markdown"), "keep");
    await expect(
      store.renameNote(named.path, "目标", named.revision),
    ).rejects.toThrow();
    expect(await readFile(join(root, "目标.markdown"), "utf8")).toBe("keep");
  });
  it("supports case-only renames and remaps favorites", async () => {
    const note = await store.createNote("md");
    await store.toggleFavorite(note.path);
    const renamed = await store.renameNote(
      note.path,
      "untitled",
      note.revision,
    );
    expect(renamed.path).toBe("untitled.md");
    expect(await readdir(root)).toEqual(["untitled.md"]);
    expect((await store.snapshot()).config.favorites).toEqual(["untitled.md"]);
  });
  it("manages nested folders, remaps metadata and only deletes empty folders", async () => {
    await store.createFolder("工作/项目");
    const note = await store.createNote("txt", "工作/项目");
    await store.toggleFavorite(note.path);
    await store.updatePreferences({ lastNote: note.path });
    await store.renameFolder("工作", "事业");
    const snap = await store.snapshot();
    expect(snap.folders).toEqual(["事业", "事业/项目"]);
    expect(snap.config.favorites).toContain("事业/项目/Untitled.txt");
    expect(snap.config.preferences.lastNote).toBe("事业/项目/Untitled.txt");
    await expect(store.deleteFolder("事业")).rejects.toThrow();
    const renamed = await store.readNote("事业/项目/Untitled.txt");
    await store.deleteNote(renamed.path, renamed.revision);
    await store.deleteFolder("事业/项目");
    await store.deleteFolder("事业");
    expect((await store.snapshot()).folders).toEqual([]);
  });
  it("rejects directory escapes, unsafe names, and symbolic links", async () => {
    await writeFile(join(base, "secret.md"), "secret");
    await symlink(base, join(root, "escape"));
    await symlink(join(base, "secret.md"), join(root, "linked.md"));
    for (const path of [
      "../secret.md",
      "/secret.md",
      "escape/secret.md",
      "linked.md",
    ]) {
      await expect(store.readNote(path)).rejects.toThrow();
    }
    await expect(store.createFolder("../bad")).rejects.toThrow();
    const note = await store.createNote("md");
    for (const title of [
      "../bad",
      "a/b",
      "a\\b",
      ".",
      "CON",
      "bad\u0000name",
    ]) {
      await expect(
        store.renameNote(note.path, title, note.revision),
      ).rejects.toThrow();
    }
    expect((await store.snapshot()).notes).toHaveLength(1);
  });
  it("rejects a root whose ancestor was replaced by a symbolic link", async () => {
    const container = join(base, "container");
    const guardedRoot = join(container, "notes");
    const guarded = new FileStore({
      configDir: join(base, "guarded-config"),
      defaultRoot: guardedRoot,
    });
    await guarded.init();
    const note = await guarded.createNote("md");
    await rename(container, join(base, "original-container"));
    await mkdir(join(base, "outside/notes"), { recursive: true });
    await writeFile(join(base, "outside/notes", note.path), "outside");
    await symlink(join(base, "outside"), container);
    await expect(guarded.readNote(note.path)).rejects.toThrow();
    await expect(
      guarded.saveNote(note.path, "overwrite", note.revision),
    ).rejects.toThrow();
    expect(await readFile(join(base, "outside/notes", note.path), "utf8")).toBe(
      "outside",
    );
  });
  it("ignores unsupported files and surfaces symlink warnings", async () => {
    await writeFile(join(root, "image.png"), "image");
    await writeFile(join(root, "notes.markdown"), "# Markdown");
    await symlink(join(root, "notes.markdown"), join(root, "alias.md"));
    const snap = await store.snapshot();
    expect(snap.notes.map((n) => n.path)).toEqual(["notes.markdown"]);
    expect(snap.warnings.join(" ")).toContain("alias.md");
  });
});

describe("local Markdown image assets", () => {
  it("reads a contained image as a typed data URI", async () => {
    await store.createFolder("assets");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(join(root, "assets/photo.PNG"), bytes);
    expect(await store.readAsset("assets/photo.PNG")).toBe(
      `data:image/png;base64,${bytes.toString("base64")}`,
    );
  });
  it("rejects traversal, links and non-raster formats", async () => {
    await writeFile(join(base, "outside.png"), "outside");
    await symlink(join(base, "outside.png"), join(root, "linked.png"));
    await writeFile(join(root, "unsafe.svg"), "<svg onload=alert(1) />");
    await writeFile(join(root, "script.html"), "<script>alert(1)</script>");
    for (const path of [
      "../outside.png",
      "/outside.png",
      "linked.png",
      "unsafe.svg",
      "script.html",
    ]) {
      await expect(store.readAsset(path)).rejects.toThrow();
    }
  });
  it("rejects images larger than 10 MB", async () => {
    await writeFile(
      join(root, "large.jpg"),
      Buffer.alloc(10 * 1024 * 1024 + 1),
    );
    await expect(store.readAsset("large.jpg")).rejects.toThrow("10 MB");
  });
});

describe("configuration and migration", () => {
  it("persists favorites/preferences and validates runtime inputs", async () => {
    const note = await store.createNote("md");
    await store.toggleFavorite(note.path);
    await store.updatePreferences({ theme: "dark", fontSize: 18 });
    const config = (await store.snapshot()).config;
    expect(config.favorites).toEqual([note.path]);
    expect(config.preferences.theme).toBe("dark");
    await expect(
      store.updatePreferences({ theme: "evil" as any }),
    ).rejects.toThrow();
    await expect(store.updatePreferences({ fontSize: 1000 })).rejects.toThrow();
    await expect(
      store.updatePreferences({ root: "/tmp" } as any),
    ).rejects.toThrow();
    expect((await store.snapshot()).config.root).toBe(root);
  });
  it("keeps an unavailable configured directory recoverable without recreating it", async () => {
    await rm(root, { recursive: true });
    const reopened = new FileStore({
      configDir: join(base, "config"),
      defaultRoot: join(base, "ignored"),
    });
    await reopened.init();
    const snap = await reopened.snapshot();
    expect(snap.config.root).toBe(root);
    expect(snap.warnings.join(" ")).toContain("目录");
    await expect(readdir(root)).rejects.toThrow();
    const recovered = await reopened.changeRoot(
      join(base, "recovered"),
      false,
      true,
    );
    expect(recovered.notes).toEqual([]);
  });
  it("does not overwrite a corrupt configuration", async () => {
    const configDir = join(base, "broken-config");
    await mkdir(configDir);
    const file = join(configDir, "config.json");
    await writeFile(file, "{bad");
    const broken = new FileStore({ configDir, defaultRoot: join(base, "new") });
    await expect(broken.init()).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{bad");
  });
  it("rejects a notes root containing application configuration", async () => {
    await expect(store.changeRoot(base, false)).rejects.toThrow("配置");
    await expect(store.changeRoot(join(base, "config"), false)).rejects.toThrow(
      "配置",
    );
    expect((await store.snapshot()).config.root).toBe(root);
  });
  it("requires explicit permission to create a missing directory", async () => {
    const missing = join(base, "missing");
    await expect(store.changeRoot(missing, false)).rejects.toThrow();
    expect((await store.snapshot()).config.root).toBe(root);
    const changed = await store.changeRoot(missing, false, true);
    expect(changed.config.root).toBe(missing);
    expect(changed.notes).toEqual([]);
  });
  it("copies notes and linked assets, verifies destination, and preserves originals", async () => {
    await store.createFolder("工作");
    const note = await store.createNote("md", "工作");
    await store.saveNote(note.path, "![photo](photo.png)", note.revision);
    await writeFile(join(root, "工作/photo.png"), "asset bytes");
    const destination = join(base, "destination");
    const snap = await store.changeRoot(destination, true, true);
    expect(snap.config.root).toBe(destination);
    expect(snap.notes).toHaveLength(1);
    expect(await readFile(join(destination, "工作/photo.png"), "utf8")).toBe(
      "asset bytes",
    );
    expect(await readFile(join(root, note.path), "utf8")).toContain("photo");
  });
  it("detects new source files created while migration is copying", async () => {
    await store.createNote("md");
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        writeFile(join(root, `asset-${i}.png`), "asset"),
      ),
    );
    const destination = join(base, "watched-destination");
    await mkdir(destination);
    const mutation = (async () => {
      for (let attempt = 0; attempt < 500; attempt++) {
        if ((await readdir(destination)).length) {
          await writeFile(
            join(root, "late.md"),
            "external note created during migration",
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      throw new Error("Copy never started");
    })();
    try {
      await expect(store.changeRoot(destination, true)).rejects.toThrow("变化");
      expect((await store.snapshot()).config.root).toBe(root);
      expect(await readFile(join(root, "late.md"), "utf8")).toContain(
        "external note",
      );
    } finally {
      await mutation;
    }
  });
  it("preflights collisions before copying anything and keeps the old root", async () => {
    await store.createNote("md");
    await store.createNote("txt");
    const destination = join(base, "destination");
    await mkdir(destination);
    await writeFile(join(destination, "Untitled.txt"), "keep me");
    await expect(store.changeRoot(destination, true)).rejects.toThrow();
    expect(await readdir(destination)).toEqual(["Untitled.txt"]);
    expect(await readFile(join(destination, "Untitled.txt"), "utf8")).toBe(
      "keep me",
    );
    expect((await store.snapshot()).config.root).toBe(root);
  });
  it("rejects nested migration roots and symbolic links before copying", async () => {
    await store.createNote("md");
    await expect(
      store.changeRoot(join(root, "nested"), true, true),
    ).rejects.toThrow();
    await symlink(base, join(root, "linked"));
    const target = join(base, "target");
    await expect(store.changeRoot(target, true, true)).rejects.toThrow();
    expect((await store.snapshot()).config.root).toBe(root);
  });
});
