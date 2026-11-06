import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import {
  DEFAULT_PREFERENCES,
  type AppConfig,
  type Note,
  type NoteKind,
  type NoteType,
  type Preferences,
  type Snapshot,
  type StorageAPI,
} from "../src/types";
import { getNoteTemplate } from "../src/lib/noteTemplates";

const TYPES = new Set([".md", ".txt", ".markdown"]);
const hash = (content: string | Uint8Array) =>
  createHash("sha256").update(content).digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const conflict = () =>
  new Error(
    "CONFLICT: 文件已被其他程序修改或删除。你的草稿仍被保留，请先处理冲突。",
  );
const inside = (parent: string, child: string) => {
  const r = relative(parent, child);
  return !r || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
};

function validSegment(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value === "." ||
    value === ".." ||
    /[<>:"/\\|?*\u0000-\u001f]/.test(value) ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ||
    Buffer.byteLength(value) > 240
  ) {
    throw new Error("名称无效：请使用不含路径分隔符和特殊字符的文件名。");
  }
  return value;
}
function validRelative(value: string, allowRoot = false): string {
  if (value === "" && allowRoot) return "";
  if (
    typeof value !== "string" ||
    isAbsolute(value) ||
    value.includes("\\") ||
    value.length > 4096
  )
    throw new Error("文件路径无效。");
  if (
    value
      .split("/")
      .some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          /[\u0000-\u001f]/.test(segment),
      )
  )
    throw new Error("文件路径无效。");
  return value;
}
function validatePreferences(
  patch: Partial<Preferences>,
): Partial<Preferences> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("设置格式无效。");
  const valid: Partial<Preferences> = {};
  for (const [key, value] of Object.entries(patch)) {
    let okay = false;
    switch (key) {
      case "theme":
        okay =
          typeof value === "string" &&
          ["system", "light", "dark"].includes(value);
        break;
      case "defaultType":
        okay = typeof value === "string" && ["md", "txt"].includes(value);
        break;
      case "fontFamily":
        okay =
          typeof value === "string" &&
          ["system", "serif", "mono"].includes(value);
        break;
      case "restoreLastNote":
      case "sidebarCollapsed":
        okay = typeof value === "boolean";
        break;
      case "fontSize":
        okay =
          typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 12 &&
          value <= 28;
        break;
      case "sidebarWidth":
        okay =
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 160 &&
          value <= 360;
        break;
      case "listWidth":
        okay =
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 220 &&
          value <= 520;
        break;
      case "lastNote":
        okay =
          value === null ||
          (typeof value === "string" && !!validRelative(value));
        break;
      default:
        throw new Error(`未知设置：${key}`);
    }
    if (!okay) throw new Error(`设置值无效：${key}`);
    Object.assign(valid, { [key]: value });
  }
  return valid;
}

function validateNoteTypes(value: unknown): Record<string, NoteKind> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("笔记分类配置格式无效。");
  const entries = Object.entries(value);
  for (const [path, kind] of entries) {
    validRelative(path);
    if (
      ![".md", ".markdown"].includes(extname(path).toLowerCase()) ||
      !["markdown", "qa", "study", "code"].includes(kind)
    )
      throw new Error("笔记分类配置格式无效。");
  }
  return Object.fromEntries(entries) as Record<string, NoteKind>;
}

/** All public operations share a queue, so two app windows cannot race their own writes. */
export class FileStore implements StorageAPI {
  private config!: AppConfig;
  private tail: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, { stamp: string; note: Note }>();
  private initialized = false;
  constructor(
    private readonly options: { configDir: string; defaultRoot: string },
  ) {}
  private get configPath() {
    return join(this.options.configDir, "config.json");
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
  async init(): Promise<void> {
    return this.serial(async () => {
      if (this.initialized) return;
      await fs.mkdir(this.options.configDir, { recursive: true });
      try {
        const raw = JSON.parse(await fs.readFile(this.configPath, "utf8"));
        if (
          typeof raw.root !== "string" ||
          !isAbsolute(raw.root) ||
          !Array.isArray(raw.favorites) ||
          !raw.favorites.every(
            (v: unknown) => typeof v === "string" && validRelative(v),
          ) ||
          !raw.preferences
        )
          throw new Error("配置格式无效");
        this.config = {
          root: raw.root,
          layoutVersion: raw.layoutVersion ?? 1,
          favorites: [...new Set<string>(raw.favorites)],
          noteTypes: validateNoteTypes(raw.noteTypes),
          preferences: {
            ...DEFAULT_PREFERENCES,
            ...validatePreferences(raw.preferences),
          },
        };
        // An unavailable saved root remains recoverable through Settings; never recreate it.
        try {
          this.config.root = await this.validateRoot(this.config.root, false);
        } catch {
          /* snapshot reports the inaccessible root while preserving this config. */
        }
        if (raw.layoutVersion === undefined) {
          // Replace the former default once; subsequent manual resizing is kept.
          if (this.config.preferences.sidebarWidth === 220)
            this.config.preferences.sidebarWidth =
              DEFAULT_PREFERENCES.sidebarWidth;
          await this.persist(this.config);
        }
      } catch (error) {
        if (code(error) !== "ENOENT")
          throw new Error(
            `无法读取 xnote 配置或笔记目录：${(error as Error).message}。原配置未被覆盖。`,
          );
        // ENOENT may mean a missing saved root; distinguish it from a first launch.
        try {
          await fs.access(this.configPath);
        } catch (missing) {
          if (code(missing) !== "ENOENT") throw missing;
          const root = await this.validateRoot(this.options.defaultRoot, true);
          this.config = {
            root,
            layoutVersion: 1,
            favorites: [],
            noteTypes: {},
            preferences: { ...DEFAULT_PREFERENCES },
          };
          await this.persist(this.config);
          this.initialized = true;
          return;
        }
        throw new Error(
          "笔记目录不存在或不可访问。请恢复原目录后重新打开 xnote，原配置已保留。",
        );
      }
      this.initialized = true;
    });
  }
  private async persist(next: AppConfig) {
    const temp = join(this.options.configDir, `.config-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, JSON.stringify(next, null, 2), {
        flag: "wx",
        mode: 0o600,
      });
      await fs.rename(temp, this.configPath);
      this.config = clone(next);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined);
    }
  }
  private async validateRoot(value: string, create: boolean): Promise<string> {
    if (typeof value !== "string" || !value.trim() || value.includes("\0"))
      throw new Error("请输入有效的绝对目录路径。");
    const expanded =
      value === "~"
        ? homedir()
        : value.startsWith("~/")
          ? join(homedir(), value.slice(2))
          : value;
    if (!isAbsolute(expanded)) throw new Error("笔记目录必须是绝对路径。");
    const target = resolve(expanded);
    if (create) await fs.mkdir(target, { recursive: true });
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("笔记目录必须是普通目录，不能是符号链接。");
    await fs.access(target, constants.R_OK | constants.W_OK);
    const canonical = await fs.realpath(target);
    if (inside(canonical, await fs.realpath(this.options.configDir)))
      throw new Error("笔记目录不能包含应用配置目录，请选择其他位置。");
    return canonical;
  }
  /** Resolve each path component without following links, including the root itself. */
  private async safePath(
    path: string,
    allowMissingLast = false,
    allowRoot = false,
  ): Promise<string> {
    validRelative(path, allowRoot);
    const rootStat = await fs.lstat(this.config.root);
    if (
      !rootStat.isDirectory() ||
      rootStat.isSymbolicLink() ||
      (await fs.realpath(this.config.root)) !== this.config.root
    )
      throw new Error("笔记目录不可访问或已被替换，请重新选择目录。");
    let current = this.config.root;
    const segments = path ? path.split("/") : [];
    for (let index = 0; index < segments.length; index++) {
      current = join(current, segments[index]);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink())
          throw new Error(`为保护文件，拒绝访问符号链接：${path}`);
        if (index < segments.length - 1 && !stat.isDirectory())
          throw new Error(`父路径不是文件夹：${path}`);
      } catch (error) {
        if (
          allowMissingLast &&
          index === segments.length - 1 &&
          code(error) === "ENOENT"
        )
          return current;
        throw error;
      }
    }
    return current;
  }
  private assertNote(path: string) {
    validRelative(path);
    if (!TYPES.has(extname(path).toLowerCase()))
      throw new Error("不支持的文件类型，请使用 .md、.markdown 或 .txt。");
  }
  private async read(path: string, cached = false): Promise<Note> {
    this.assertNote(path);
    const target = await this.safePath(path);
    // O_NOFOLLOW also closes the final-component symlink race between lstat and open.
    const handle = await fs.open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("目标不是普通笔记文件。");
      const noteType = this.config.noteTypes?.[path];
      const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}:${noteType ?? ""}`;
      const existing = this.cache.get(path);
      if (cached && existing?.stamp === stamp) return clone(existing.note);
      if (stat.size > 25 * 1024 * 1024)
        throw new Error("文件超过 25 MB，暂不支持在 xnote 中编辑。");
      const bytes = await handle.readFile();
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const ext = extname(path);
      const note: Note = {
        path,
        title: basename(path, ext),
        type: ext.slice(1).toLowerCase() as NoteType,
        ...(noteType ? { noteType } : {}),
        folder: dirname(path) === "." ? "" : dirname(path).split(sep).join("/"),
        modifiedAt: stat.mtimeMs,
        preview: content
          .replace(/[#>*_`\[\]]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180),
        content,
        revision: hash(bytes),
      };
      this.cache.set(path, { stamp, note });
      return clone(note);
    } finally {
      await handle.close();
    }
  }
  private async checkRevision(path: string, revision: string): Promise<Note> {
    try {
      const note = await this.read(path);
      if (typeof revision !== "string" || revision !== note.revision)
        throw conflict();
      return note;
    } catch (error) {
      if (code(error) === "ENOENT") throw conflict();
      throw error;
    }
  }
  private async scan(): Promise<Snapshot> {
    const notes: Note[] = [],
      folders: string[] = [],
      warnings: string[] = [];
    try {
      await this.safePath("", false, true);
    } catch (error) {
      return {
        config: clone(this.config),
        notes,
        folders,
        warnings: [
          `笔记目录不可访问，请在设置中重新选择目录：${(error as Error).message}`,
        ],
      };
    }
    const walk = async (folder: string) => {
      let entries;
      try {
        entries = await fs.readdir(await this.safePath(folder, false, true), {
          withFileTypes: true,
        });
      } catch (error) {
        if (!folder) throw error;
        warnings.push(`无法读取文件夹 ${folder}：${(error as Error).message}`);
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.name.startsWith(".xnote-")) continue;
        if (entry.isSymbolicLink()) {
          warnings.push(`已跳过符号链接：${path}`);
          continue;
        }
        if (entry.isDirectory()) {
          folders.push(path);
          await walk(path);
        } else if (entry.isFile() && TYPES.has(extname(path).toLowerCase())) {
          try {
            notes.push(await this.read(path, true));
          } catch (error) {
            warnings.push(`无法读取 ${path}：${(error as Error).message}`);
          }
        }
      }
    };
    await walk("");
    const present = new Set(notes.map((n) => n.path));
    for (const path of this.cache.keys())
      if (!present.has(path)) this.cache.delete(path);
    notes.sort(
      (a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path),
    );
    return { config: clone(this.config), notes, folders, warnings };
  }
  snapshot() {
    return this.serial(() => this.scan());
  }
  readNote(path: string) {
    return this.serial(() => this.read(path));
  }
  /** Only inert raster assets from the current library may reach Markdown previews. */
  readAsset(path: string): Promise<string> {
    return this.serial(async () => {
      validRelative(path);
      const mimeTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".bmp": "image/bmp",
      };
      const mime = mimeTypes[extname(path).toLowerCase()];
      if (!mime)
        throw new Error("仅支持 PNG、JPEG、GIF、WebP、AVIF 和 BMP 图片。");
      const target = await this.safePath(path);
      const handle = await fs.open(
        target,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error("图片路径不是普通文件。");
        if (stat.size > 10 * 1024 * 1024)
          throw new Error("图片不能超过 10 MB。");
        const bytes = await handle.readFile();
        if (bytes.byteLength > 10 * 1024 * 1024)
          throw new Error("图片不能超过 10 MB。");
        return `data:${mime};base64,${bytes.toString("base64")}`;
      } finally {
        await handle.close();
      }
    });
  }
  createNote(type: "md" | "txt", folder = "", templateId?: string) {
    return this.serial(async () => {
      if (type !== "md" && type !== "txt")
        throw new Error("新笔记类型必须是 Markdown 或 TXT。");
      const template =
        templateId === undefined ? undefined : getNoteTemplate(templateId);
      if (templateId !== undefined && !template)
        throw new Error("模板不存在，请重新选择模板。");
      if (template && template.fileExtension !== type)
        throw new Error("模板与笔记文件类型不匹配。");
      const parent = await this.safePath(folder, false, true);
      const title = template?.defaultTitle ?? "Untitled";
      const content = template?.initialContent ?? "";
      const temp = join(parent, `.xnote-${randomUUID()}.tmp`);
      try {
        let templateStat: { dev: number; ino: number } | undefined;
        if (template) {
          // Only templates need atomic publication of their initial body.
          const handle = await fs.open(temp, "wx", 0o600);
          try {
            await handle.writeFile(content, "utf8");
            await handle.sync();
            templateStat = await handle.stat();
          } finally {
            await handle.close();
          }
        }
        for (let index = 1; index < 100000; index++) {
          const name = validSegment(
            `${title}${index > 1 ? ` ${index}` : ""}.${type}`,
          );
          const path = folder ? `${folder}/${name}` : name;
          const target = join(parent, name);
          let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
          let created = templateStat;
          try {
            if (template) await fs.link(temp, target);
            else handle = await fs.open(target, "wx", 0o600);
          } catch (error) {
            if (code(error) === "EEXIST") continue;
            throw error;
          }
          try {
            if (handle) created = await handle.stat();
            const { noteType: _previousType, ...note } = await this.read(path);
            const next = clone(this.config);
            const noteTypes = { ...next.noteTypes };
            if (template) noteTypes[path] = template.noteType;
            else delete noteTypes[path];
            if (template || this.config.noteTypes?.[path]) {
              next.noteTypes = noteTypes;
              await this.persist(next);
            }
            this.cache.delete(path);
            return {
              ...note,
              ...(template ? { noteType: template.noteType } : {}),
            };
          } catch (error) {
            this.cache.delete(path);
            try {
              const current = await fs.lstat(target);
              if (
                created &&
                current.dev === created.dev &&
                current.ino === created.ino &&
                hash(await fs.readFile(target)) === hash(content)
              )
                await fs.unlink(target);
            } catch {
              /* Retain a file that another program may have changed or replaced. */
            }
            throw error;
          } finally {
            await handle?.close();
          }
        }
        throw new Error("无法生成可用文件名，请重命名部分笔记。");
      } finally {
        if (template) await fs.rm(temp, { force: true }).catch(() => undefined);
      }
    });
  }
  saveNote(path: string, content: string, revision: string) {
    return this.serial(async () => {
      if (typeof content !== "string") throw new Error("笔记正文必须是文本。");
      if (Buffer.byteLength(content) > 25 * 1024 * 1024)
        throw new Error("笔记不能超过 25 MB。");
      const acknowledged = await this.checkRevision(path, revision);
      const target = await this.safePath(path);
      const stat = await fs.stat(target);
      const temp = join(dirname(target), `.xnote-${randomUUID()}.tmp`);
      try {
        const handle = await fs.open(temp, "wx", stat.mode & 0o777);
        try {
          await handle.writeFile(content, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        const writtenAt = (await fs.stat(temp)).mtimeMs;
        // Check again after writing the temp file, immediately before the atomic replacement.
        await this.checkRevision(path, revision);
        await fs.rename(temp, target);
        this.cache.delete(path);
        // A post-write reread may already contain another editor's update. Return only
        // the body/revision this operation actually wrote, never an unseen baseline.
        return {
          ...acknowledged,
          content,
          revision: hash(Buffer.from(content, "utf8")),
          modifiedAt: writtenAt,
          preview: content
            .replace(/[#>*_`\[\]]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180),
        };
      } finally {
        await fs.rm(temp, { force: true }).catch(() => undefined);
      }
    });
  }
  private remapConfig(from: string, to?: string): AppConfig {
    const next = clone(this.config);
    const remap = (path: string) =>
      path === from || path.startsWith(`${from}/`)
        ? to
          ? `${to}${path.slice(from.length)}`
          : null
        : path;
    next.favorites = next.favorites
      .map(remap)
      .filter((path): path is string => path !== null);
    if (next.preferences.lastNote)
      next.preferences.lastNote = remap(next.preferences.lastNote);
    next.noteTypes = Object.fromEntries(
      Object.entries(next.noteTypes ?? {}).flatMap(([path, kind]) => {
        // An absent destination file may still have stale metadata after an
        // external deletion. The source classification owns the renamed path.
        if (to && (path === to || path.startsWith(`${to}/`))) return [];
        const mapped = remap(path);
        return mapped === null ? [] : [[mapped, kind]];
      }),
    );
    return next;
  }
  renameNote(path: string, title: string, revision: string) {
    return this.serial(async () => {
      const acknowledged = await this.checkRevision(path, revision);
      validSegment(title);
      const folder =
        dirname(path) === "." ? "" : dirname(path).split(sep).join("/");
      const name = `${title}${extname(path)}`;
      validSegment(name);
      const nextPath = folder ? `${folder}/${name}` : name;
      if (nextPath === path) return acknowledged;
      const source = await this.safePath(path),
        target = await this.safePath(nextPath, true);
      // link() has exclusive destination semantics, unlike rename(), which overwrites existing files.
      let caseOnly = false;
      try {
        await fs.link(source, target);
      } catch (error) {
        // On case-insensitive volumes, two spellings refer to the same directory entry.
        // Never apply this fallback to a separately existing target (even a hard link).
        if (
          code(error) !== "EEXIST" ||
          basename(source).toLowerCase() !== basename(target).toLowerCase()
        )
          throw error;
        const entries = await fs.readdir(dirname(source));
        const [fromStat, toStat] = await Promise.all([
          fs.lstat(source),
          fs.lstat(target),
        ]);
        if (
          entries.includes(basename(target)) ||
          !entries.includes(basename(source)) ||
          fromStat.dev !== toStat.dev ||
          fromStat.ino !== toStat.ino
        )
          throw error;
        await this.checkRevision(path, revision);
        await fs.rename(source, target);
        caseOnly = true;
      }
      if (!caseOnly) {
        try {
          await fs.unlink(source);
        } catch (error) {
          await fs.unlink(target).catch(() => undefined);
          throw error;
        }
      }
      this.cache.delete(path);
      await this.persist(this.remapConfig(path, nextPath));
      // Preserve the acknowledged content revision while reporting the new path.
      // External edits after rename must be handled by the next read/conflict check.
      return { ...acknowledged, path: nextPath, title, folder };
    });
  }
  deleteNote(path: string, revision: string) {
    return this.serial(async () => {
      await this.checkRevision(path, revision);
      await fs.unlink(await this.safePath(path));
      this.cache.delete(path);
      await this.persist(this.remapConfig(path));
    });
  }
  createFolder(path: string) {
    return this.serial(async () => {
      validRelative(path);
      path.split("/").forEach(validSegment);
      let current = "";
      for (const segment of path.split("/")) {
        current = current ? `${current}/${segment}` : segment;
        const target = await this.safePath(current, true);
        try {
          await fs.mkdir(target);
        } catch (error) {
          if (
            code(error) !== "EEXIST" ||
            !(await fs.lstat(target)).isDirectory()
          )
            throw error;
        }
      }
    });
  }
  renameFolder(path: string, name: string) {
    return this.serial(async () => {
      validRelative(path);
      validSegment(name);
      const parent =
        dirname(path) === "." ? "" : dirname(path).split(sep).join("/");
      const nextPath = parent ? `${parent}/${name}` : name;
      if (nextPath === path) return;
      const source = await this.safePath(path);
      if (!(await fs.lstat(source)).isDirectory())
        throw new Error("目标不是文件夹。");
      const target = await this.safePath(nextPath, true);
      try {
        await fs.lstat(target);
        throw new Error("已存在同名文件或文件夹，请换一个名称。");
      } catch (error) {
        if (code(error) !== "ENOENT") throw error;
      }
      await fs.rename(source, target);
      this.cache.clear();
      await this.persist(this.remapConfig(path, nextPath));
    });
  }
  deleteFolder(path: string) {
    return this.serial(async () => {
      const target = await this.safePath(path);
      try {
        await fs.rmdir(target);
      } catch (error) {
        if (code(error) === "ENOTEMPTY" || code(error) === "EEXIST")
          throw new Error("只能删除空文件夹。请先移出或删除其中的文件。");
        throw error;
      }
      await this.persist(this.remapConfig(path));
    });
  }
  toggleFavorite(path: string) {
    return this.serial(async () => {
      await this.read(path);
      const next = clone(this.config);
      next.favorites = next.favorites.includes(path)
        ? next.favorites.filter((p) => p !== path)
        : [...next.favorites, path];
      await this.persist(next);
      return clone(this.config);
    });
  }
  updatePreferences(patch: Partial<Preferences>) {
    return this.serial(async () => {
      const validated = validatePreferences(patch);
      const next = clone(this.config);
      Object.assign(next.preferences, validated);
      await this.persist(next);
      return clone(this.config);
    });
  }
  changeRoot(path: string, migrate: boolean, create = false) {
    return this.serial(async () => {
      if (typeof migrate !== "boolean" || typeof create !== "boolean")
        throw new Error("目录操作参数无效。");
      const expanded =
        path === "~"
          ? homedir()
          : path.startsWith("~/")
            ? join(homedir(), path.slice(2))
            : path;
      const proposed = resolve(expanded);
      if (
        migrate &&
        proposed !== this.config.root &&
        (inside(this.config.root, proposed) ||
          inside(proposed, this.config.root))
      )
        throw new Error("迁移目录不能互相包含，请选择独立目录。");
      const destination = await this.validateRoot(path, create);
      if (destination === this.config.root) return this.scan();
      if (
        migrate &&
        (inside(this.config.root, destination) ||
          inside(destination, this.config.root))
      )
        throw new Error("迁移目录不能互相包含。");
      if (migrate) await this.copyTo(destination);
      const next = clone(this.config);
      next.root = destination;
      if (!migrate) {
        next.favorites = [];
        next.noteTypes = {};
        next.preferences.lastNote = null;
      }
      await this.persist(next);
      this.cache.clear();
      return this.scan();
    });
  }
  /** Copy first, never delete the source. A failed copy cannot destroy the original library. */
  private async copyTo(destination: string) {
    const files: { relative: string; revision: string }[] = [];
    const directories: string[] = [];
    const collect = async (folder: string) => {
      const source = await this.safePath(folder, false, true);
      for (const entry of await fs.readdir(source, { withFileTypes: true })) {
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        const target = await this.safePath(path);
        if (entry.isSymbolicLink())
          throw new Error(`迁移包含符号链接，已停止：${path}`);
        if (entry.isDirectory()) {
          directories.push(path);
          await collect(path);
        } else if (entry.isFile()) {
          const content = await fs.readFile(target);
          files.push({ relative: path, revision: hash(content) });
        } else throw new Error(`无法迁移特殊文件：${path}`);
      }
    };
    await collect("");
    // Validate the full destination tree before creating any file; existing directories may merge.
    for (const path of [
      ...directories,
      ...files.map((file) => file.relative),
    ]) {
      const parts = path.split("/");
      for (let i = 0; i < parts.length; i++) {
        const current = join(destination, ...parts.slice(0, i + 1));
        try {
          const stat = await fs.lstat(current);
          if (stat.isSymbolicLink())
            throw new Error(`目标包含符号链接：${path}`);
          const expectedDirectory =
            i < parts.length - 1 || directories.includes(path);
          if (!expectedDirectory || !stat.isDirectory())
            throw new Error(`迁移已停止，目标存在同名文件：${path}`);
        } catch (error) {
          if (code(error) !== "ENOENT") throw error;
        }
      }
    }
    const createdFiles: { path: string; revision: string }[] = [],
      createdDirectories: string[] = [];
    try {
      for (const path of directories) {
        const target = join(destination, path);
        try {
          await fs.mkdir(target);
          createdDirectories.push(target);
        } catch (error) {
          if (
            code(error) !== "EEXIST" ||
            (await fs.lstat(target)).isSymbolicLink()
          )
            throw error;
        }
      }
      for (const file of files) {
        // Detect source edits during preflight instead of switching to a stale copied library.
        if (
          hash(await fs.readFile(await this.safePath(file.relative))) !==
          file.revision
        )
          throw new Error(`源文件在迁移时发生变化，请重试：${file.relative}`);
        const target = join(destination, file.relative);
        await fs.copyFile(
          await this.safePath(file.relative),
          target,
          constants.COPYFILE_EXCL,
        );
        createdFiles.push({ path: target, revision: file.revision });
        if (hash(await fs.readFile(target)) !== file.revision)
          throw new Error(`迁移校验失败：${file.relative}`);
      }
      // Verify the full source inventory as well as content: new files created during
      // copying must not silently disappear when the application switches roots.
      const expectedDirectories = new Set(directories);
      const expectedFiles = new Map(
        files.map((file) => [file.relative, file.revision]),
      );
      const verifySource = async (folder: string) => {
        for (const entry of await fs.readdir(
          await this.safePath(folder, false, true),
          { withFileTypes: true },
        )) {
          const path = folder ? `${folder}/${entry.name}` : entry.name;
          if (entry.isDirectory() && expectedDirectories.delete(path))
            await verifySource(path);
          else if (entry.isFile() && expectedFiles.has(path)) {
            if (
              hash(await fs.readFile(await this.safePath(path))) !==
              expectedFiles.get(path)
            )
              throw new Error(`源文件在迁移时发生变化，请重试：${path}`);
            expectedFiles.delete(path);
          } else throw new Error(`源目录在迁移时发生变化，请重试：${path}`);
        }
      };
      await verifySource("");
      if (expectedDirectories.size || expectedFiles.size)
        throw new Error("源目录在迁移时发生变化，请重试。");
    } catch (error) {
      for (const file of createdFiles.reverse()) {
        // If another program edited a newly copied file, retain it instead of deleting that edit.
        try {
          if (hash(await fs.readFile(file.path)) === file.revision)
            await fs.unlink(file.path);
        } catch {
          /* keep a potentially changed file */
        }
      }
      for (const target of createdDirectories.reverse())
        await fs.rmdir(target).catch(() => undefined);
      throw error;
    }
  }
}
