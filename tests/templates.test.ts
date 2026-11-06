import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configFailure = vi.hoisted(() => ({
  target: "",
  externalEdit: "",
  unsupportedLinks: false,
}));
// All file operations are real; inject only a configuration commit failure.
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    link: async (
      source: Parameters<typeof original.link>[0],
      target: Parameters<typeof original.link>[1],
    ) => {
      if (configFailure.unsupportedLinks)
        throw Object.assign(new Error("hard links unsupported"), {
          code: "ENOTSUP",
        });
      return original.link(source, target);
    },
    rename: async (
      source: Parameters<typeof original.rename>[0],
      target: Parameters<typeof original.rename>[1],
    ) => {
      if (target === configFailure.target) {
        if (configFailure.externalEdit)
          await original.writeFile(configFailure.externalEdit, "external edit");
        throw Object.assign(new Error("configuration commit failed"), {
          code: "EEXIST",
        });
      }
      return original.rename(source, target);
    },
  };
});
import { FileStore } from "../server/store";

const expectedTemplates = [
  {
    id: "qa",
    title: "新建问答",
    noteType: "qa",
    content:
      "# 新建问答\n\n## 问题\n\n在这里记录你不理解的问题。\n\n## 原始内容\n\n可以粘贴代码、报错信息、文档片段或其他相关内容。\n\n## 答案\n\n在这里记录查询后得到的答案。\n\n## 详细解释\n\n在这里补充原理、实现过程和关键知识点。\n\n## 补充记录\n\n记录自己的理解、后续疑问或相关参考资料。\n",
  },
  {
    id: "study",
    title: "学习主题",
    noteType: "study",
    content:
      "# 学习主题\n\n## 学习目标\n\n## 核心知识点\n\n## 详细记录\n\n## 学习总结\n\n## 待解决的问题\n",
  },
  {
    id: "code",
    title: "代码主题",
    noteType: "code",
    content:
      "# 代码主题\n\n## 使用场景\n\n## 代码内容\n\n## 实现思路\n\n## 关键知识点\n\n## 注意事项\n",
  },
  { id: "blank", title: "Untitled", noteType: "markdown", content: "" },
] as const;

let base: string;
let root: string;
let configDir: string;
let store: FileStore;
beforeEach(async () => {
  Object.assign(configFailure, {
    target: "",
    externalEdit: "",
    unsupportedLinks: false,
  });
  base = await realpath(await mkdtemp(join(tmpdir(), "xnote-templates-")));
  root = join(base, "notes");
  configDir = join(base, "config");
  store = new FileStore({ configDir, defaultRoot: root });
  await store.init();
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("built-in Markdown templates", () => {
  it("keeps ordinary MD/TXT creation working on volumes without hard links", async () => {
    configFailure.unsupportedLinks = true;
    expect((await store.createNote("md")).path).toBe("Untitled.md");
    expect((await store.createNote("txt")).path).toBe("Untitled.txt");
    await expect(store.createNote("md", "", "qa")).rejects.toThrow(
      "hard links unsupported",
    );
    expect((await readdir(root)).sort()).toEqual([
      "Untitled.md",
      "Untitled.txt",
    ]);
  });
  it.each(expectedTemplates)(
    "creates $id directly as complete Markdown",
    async (template) => {
      const note = await store.createNote("md", "", template.id);
      expect(note.path).toBe(`${template.title}.md`);
      expect(note.type).toBe("md");
      expect(note.noteType).toBe(template.noteType);
      expect(note.content).toBe(template.content);
      expect(await readFile(join(root, note.path), "utf8")).toBe(
        template.content,
      );
      expect((await store.snapshot()).notes).toEqual([note]);
    },
  );

  it("keeps each concurrent template content separate and never overwrites collisions", async () => {
    await writeFile(join(root, "新建问答.md"), "keep existing");
    await mkdir(join(root, "新建问答 2.md"));
    await symlink(base, join(root, "新建问答 3.md"));
    const notes = await Promise.all([
      store.createNote("md", "", "qa"),
      store.createNote("md", "", "qa"),
      store.createNote("md", "", "study"),
      store.createNote("md", "", "code"),
    ]);
    expect(notes.map((note) => note.path)).toEqual([
      "新建问答 4.md",
      "新建问答 5.md",
      "学习主题.md",
      "代码主题.md",
    ]);
    expect(await readFile(join(root, "新建问答.md"), "utf8")).toBe(
      "keep existing",
    );
    expect(notes.map((note) => note.content)).toEqual([
      expectedTemplates[0].content,
      expectedTemplates[0].content,
      expectedTemplates[1].content,
      expectedTemplates[2].content,
    ]);
  });

  it("preserves classification on save and restart without guessing from Markdown content", async () => {
    const qa = await store.createNote("md", "", "qa");
    await writeFile(join(root, "ordinary.md"), qa.content);
    const saved = await store.saveNote(
      qa.path,
      "# 自由修改\n\n```js\nconst answer = 42;\n```\n",
      qa.revision,
    );
    const reopened = new FileStore({
      configDir,
      defaultRoot: join(base, "ignored"),
    });
    await reopened.init();
    expect((await reopened.readNote(qa.path)).noteType).toBe("qa");
    expect((await reopened.readNote(qa.path)).content).toBe(saved.content);
    expect((await reopened.readNote("ordinary.md")).noteType).toBeUndefined();
    expect((await reopened.snapshot()).config.noteTypes?.[qa.path]).toBe("qa");
  });

  it("remaps metadata through note/folder renaming and removes it on deletion", async () => {
    await store.createFolder("工作");
    const qa = await store.createNote("md", "工作", "qa");
    const renamed = await store.renameNote(qa.path, "闭包是什么", qa.revision);
    expect(renamed.noteType).toBe("qa");
    await store.renameFolder("工作", "知识");
    const moved = await store.readNote("知识/闭包是什么.md");
    expect(moved.noteType).toBe("qa");
    expect((await store.snapshot()).config.noteTypes).toEqual({
      [moved.path]: "qa",
    });
    await store.deleteNote(moved.path, moved.revision);
    expect((await store.snapshot()).config.noteTypes).toEqual({});
    await writeFile(join(root, moved.path), "ordinary replacement");
    expect((await store.readNote(moved.path)).noteType).toBeUndefined();
  });

  it("keeps classification when migrating and clears it when switching libraries", async () => {
    const qa = await store.createNote("md", "", "qa");
    const destination = join(base, "migrated");
    const migrated = await store.changeRoot(destination, true, true);
    expect(migrated.notes[0].noteType).toBe("qa");
    expect(await readFile(join(destination, qa.path), "utf8")).toBe(qa.content);
    const otherRoot = join(base, "other");
    await mkdir(otherRoot);
    await writeFile(join(otherRoot, qa.path), qa.content);
    const switched = await store.changeRoot(otherRoot, false);
    expect(switched.notes[0].noteType).toBeUndefined();
    expect(switched.config.noteTypes).toEqual({});
  });

  it("rejects unknown templates and extension mismatches before creating files", async () => {
    await expect(store.createNote("md", "", "missing")).rejects.toThrow("模板");
    await expect(store.createNote("txt", "", "qa")).rejects.toThrow("模板");
    expect(await readdir(root)).toEqual([]);
  });

  it("rolls back its note if metadata commit fails without retrying it as a name collision", async () => {
    configFailure.target = join(configDir, "config.json");
    await expect(store.createNote("md", "", "qa")).rejects.toThrow(
      "configuration commit failed",
    );
    expect(await readdir(root)).toEqual([]);
    expect((await store.snapshot()).config.noteTypes).toEqual({});
    expect(
      (await readdir(configDir)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("retains external edits instead of deleting them during failed-create rollback", async () => {
    configFailure.target = join(configDir, "config.json");
    configFailure.externalEdit = join(root, "新建问答.md");
    await expect(store.createNote("md", "", "qa")).rejects.toThrow(
      "configuration commit failed",
    );
    expect(await readFile(configFailure.externalEdit, "utf8")).toBe(
      "external edit",
    );
  });

  it("opens older configuration files that have no classification map", async () => {
    const configPath = join(configDir, "config.json");
    const oldConfig = JSON.parse(await readFile(configPath, "utf8"));
    delete oldConfig.noteTypes;
    await writeFile(configPath, JSON.stringify(oldConfig));
    const reopened = new FileStore({ configDir, defaultRoot: root });
    await reopened.init();
    const qa = await reopened.createNote("md", "", "qa");
    expect(qa.noteType).toBe("qa");
  });

  it("clears stale classification when a regular create reuses an externally removed path", async () => {
    const qa = await store.createNote("md", "", "qa");
    const renamed = await store.renameNote(qa.path, "Untitled", qa.revision);
    await rm(join(root, renamed.path));
    const ordinary = await store.createNote("md");
    expect(ordinary.noteType).toBeUndefined();
    expect((await store.snapshot()).config.noteTypes).toEqual({});
  });

  it("does not inherit stale destination classification during an ordinary rename", async () => {
    const qa = await store.createNote("md", "", "qa");
    await rm(join(root, qa.path));
    const ordinary = await store.createNote("md");
    const renamed = await store.renameNote(
      ordinary.path,
      qa.title,
      ordinary.revision,
    );
    expect((await store.readNote(renamed.path)).noteType).toBeUndefined();
    expect((await store.snapshot()).config.noteTypes).toEqual({});
  });
});
