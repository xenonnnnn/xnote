import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Files,
  Notebook,
  PanelLeft,
  Plus,
  Search,
  CalendarDays,
  Bookmark,
  Star,
  Folder,
  FolderPlus,
  Settings as SettingsIcon,
  ChevronRight,
  FileText,
  MoreHorizontal,
  Trash2,
  ArrowDownWideNarrow,
  Check,
  CloudOff,
  PenLine,
  LoaderCircle,
  X,
  FolderOpen,
  LayoutTemplate,
} from "lucide-react";
import { useWorkspace } from "./lib/useWorkspace";
import { api, message } from "./lib/api";
import { DEFAULT_PREFERENCES, type Note } from "./types";
const NoteEditor = lazy(() => import("./components/NoteEditor"));
import Modal from "./components/Modal";
import TemplateCenter from "./components/TemplateCenter";
import WindowControls from "./components/WindowControls";
import TooltipButton from "./components/TooltipButton";
const Settings = lazy(() => import("./components/Settings"));
import "./components/editor.css";
type View = "all" | "recent" | "favorites" | "templates" | `folder:${string}`;
type Dialog =
  | { kind: "folder"; path?: string }
  | { kind: "renameFolder"; path: string }
  | { kind: "deleteFolder"; path: string }
  | { kind: "delete"; note: Note }
  | { kind: "reload" };
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const q = query.toLocaleLowerCase(),
    lower = text.toLocaleLowerCase(),
    parts: ReactNode[] = [];
  let start = 0,
    index = lower.indexOf(q);
  while (index >= 0) {
    parts.push(
      text.slice(start, index),
      <mark key={index}>{text.slice(index, index + q.length)}</mark>,
    );
    start = index + q.length;
    index = lower.indexOf(q, start);
  }
  parts.push(text.slice(start));
  return <>{parts}</>;
}
function dateLabel(timestamp: number) {
  const now = new Date(),
    date = new Date(timestamp);
  if (now.toDateString() === date.toDateString())
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
export default function App() {
  const w = useWorkspace();
  const { snapshot, draft } = w,
    p = snapshot?.config.preferences || DEFAULT_PREFERENCES;
  const [view, setView] = useState<View>("all"),
    [query, setQuery] = useState(""),
    [sortNewest, setSortNewest] = useState(true),
    [newMenu, setNewMenu] = useState(false),
    [settings, setSettings] = useState(false),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [folderName, setFolderName] = useState(""),
    [dialogError, setDialogError] = useState(""),
    [dialogBusy, setDialogBusy] = useState(false),
    [context, setContext] = useState<{
      x: number;
      y: number;
      note?: Note;
      folder?: string;
    } | null>(null),
    [noteMenu, setNoteMenu] = useState(false),
    [focusToken, setFocusToken] = useState(0),
    [systemDark, setSystemDark] = useState(
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    ),
    [widths, setWidths] = useState<{ sidebar: number; list: number } | null>(
      null,
    );
  const [newMenuAnchor, setNewMenuAnchor] = useState({ left: 14, top: 110 });
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(),
  );
  const searchRef = useRef<HTMLInputElement>(null),
    titleRef = useRef<HTMLInputElement>(null);
  const dark = p.theme === "dark" || (p.theme === "system" && systemDark),
    notes = snapshot?.notes || [],
    favorites = snapshot?.config.favorites || [];
  const folder = view.startsWith("folder:") ? view.slice(7) : "";
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!context && !newMenu && !noteMenu) return;
    const previous = document.activeElement as HTMLElement | null;
    let restoreFocus = false;
    const frame = requestAnimationFrame(() => {
      const menu = document.querySelector<HTMLElement>("[role=menu]");
      menu?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    });
    const close = () => {
      setContext(null);
      setNewMenu(false);
      setNoteMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      const menu = document.querySelector<HTMLElement>("[role=menu]");
      if (e.key === "Escape") {
        e.preventDefault();
        restoreFocus = true;
        close();
      }
      if (e.key === "Tab") close();
      if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const items = Array.from(
          menu.querySelectorAll<HTMLElement>("[role=menuitem]"),
        );
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : (index + (e.key === "ArrowUp" ? -1 : 1) + items.length) %
                items.length;
        items[next]?.focus();
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(frame);
      if (restoreFocus && previous?.isConnected)
        previous.focus({ preventScroll: true });
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", key);
    };
  }, [context, newMenu, noteMenu]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (!e.metaKey && !e.ctrlKey)) return;
      if (settings || dialog) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void w.save();
      }
      if (k === "n" && !settings && !dialog) {
        e.preventDefault();
        void create(p.defaultType);
      }
      if (k === "k" || k === "p") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (k === ",") {
        e.preventDefault();
        setSettings(true);
      }
      if (k === "\\") {
        e.preventDefault();
        void w.updatePreferences({ sidebarCollapsed: !p.sidebarCollapsed });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (view === "templates") document.title = "模板 — xnote";
    else if (draft) document.title = `${draft.title || "Untitled"} — xnote`;
    else document.title = "xnote — 留下此刻的想法";
  }, [draft?.title, view]);
  const visible = useMemo(() => {
    let filtered = notes;
    if (query.trim()) {
      const q = query.trim().toLocaleLowerCase();
      filtered = notes.filter(
        (n) =>
          n.title.toLocaleLowerCase().includes(q) ||
          n.content.toLocaleLowerCase().includes(q),
      );
    } else if (view === "favorites")
      filtered = notes.filter((n) => favorites.includes(n.path));
    else if (view === "recent")
      filtered = notes.filter((n) => Date.now() - n.modifiedAt < 7 * 86400000);
    else if (view.startsWith("folder:"))
      filtered = notes.filter(
        (n) => n.folder === folder || n.folder.startsWith(`${folder}/`),
      );
    return [...filtered].sort((a, b) =>
      sortNewest ? b.modifiedAt - a.modifiedAt : a.modifiedAt - b.modifiedAt,
    );
  }, [notes, query, view, favorites, sortNewest, folder]);
  const viewTitle = query.trim()
    ? "搜索结果"
    : view === "all" || view === "templates"
      ? "全部笔记"
      : view === "recent"
        ? "最近编辑"
        : view === "favorites"
          ? "收藏夹"
          : folder.split("/").pop();
  async function create(type: "md" | "txt", templateId?: string) {
    setNewMenu(false);
    if (!(await w.create(type, folder, templateId))) return;
    setQuery("");
    if (view === "favorites" || view === "templates") setView("all");
    setTimeout(() => {
      titleRef.current?.focus();
      titleRef.current?.select();
    }, 50);
  }
  async function favorite(note: Note) {
    try {
      await api.toggleFavorite(note.path);
      await w.refresh();
    } catch (error) {
      w.setError(message(error));
    }
  }
  async function openNote(path: string) {
    if ((await w.open(path)) && view === "templates") setView("all");
  }
  async function changeView(next: View) {
    if (w.transitioning) return;
    if (await w.save()) {
      setView(next);
      setQuery("");
      setNoteMenu(false);
    }
  }
  function openFolderDialog(value: Dialog) {
    setFolderName(
      value.kind === "renameFolder" ? value.path.split("/").pop()! : "",
    );
    setDialogError("");
    setDialog(value);
  }
  async function submitDialog() {
    if (!dialog) return;
    setDialogBusy(true);
    setDialogError("");
    try {
      if (dialog.kind === "folder") {
        if (!folderName.trim()) throw new Error("请输入文件夹名称");
        await api.createFolder(
          [dialog.path, folderName.trim()].filter(Boolean).join("/"),
        );
        await w.refresh();
      }
      if (dialog.kind === "renameFolder") {
        if (!(await w.save())) throw new Error("请先处理未保存的笔记");
        await api.renameFolder(dialog.path, folderName.trim());
        if (draft?.note.path.startsWith(`${dialog.path}/`))
          await w.open(
            draft.note.path.replace(
              `${dialog.path}/`,
              `${dialog.path.split("/").slice(0, -1).concat(folderName.trim()).join("/")}/`,
            ),
          );
        setView("all");
        await w.refresh();
      }
      if (dialog.kind === "deleteFolder") {
        await api.deleteFolder(dialog.path);
        if (folder === dialog.path) setView("all");
        await w.refresh();
      }
      if (dialog.kind === "delete") await w.remove(dialog.note);
      if (dialog.kind === "reload") await w.reloadDisk();
      setDialog(null);
    } catch (error) {
      setDialogError(message(error));
    } finally {
      setDialogBusy(false);
    }
  }
  function columnWidth(which: "sidebar" | "list") {
    return (
      document
        .querySelector<HTMLElement>(
          which === "sidebar" ? ".sidebar" : ".note-list-panel",
        )
        ?.getBoundingClientRect().width ||
      (which === "sidebar" ? p.sidebarWidth : p.listWidth)
    );
  }
  function applyWidth(which: "sidebar" | "list", value: number) {
    const maximum = which === "sidebar" ? 360 : 520;
    const next = Math.round(
      Math.min(maximum, Math.max(which === "sidebar" ? 160 : 220, value)),
    );
    setWidths((old) => ({
      sidebar: old?.sidebar ?? p.sidebarWidth,
      list: old?.list ?? p.listWidth,
      [which]: next,
    }));
    return next;
  }
  function saveWidth(which: "sidebar" | "list", next: number) {
    void w.updatePreferences(
      which === "sidebar" ? { sidebarWidth: next } : { listWidth: next },
    );
  }
  function resizeKeyboard(
    which: "sidebar" | "list",
    event: React.KeyboardEvent,
  ) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    saveWidth(
      which,
      applyWidth(
        which,
        columnWidth(which) + (event.key === "ArrowRight" ? 12 : -12),
      ),
    );
  }
  function resize(which: "sidebar" | "list", event: React.PointerEvent) {
    event.preventDefault();
    const initial = event.clientX,
      base = columnWidth(which);
    let next = base;
    const move = (e: PointerEvent) => {
      next = applyWidth(which, base + e.clientX - initial);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing");
      saveWidth(which, next);
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
  function toggleNewMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setNewMenuAnchor({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 272)),
      top: rect.bottom + 6,
    });
    setNewMenu(!newMenu);
  }
  const newNoteMenu = (
    <div
      className="popover new-popover"
      style={{
        position: "fixed",
        left: newMenuAnchor.left,
        top: newMenuAnchor.top,
      }}
      role="menu"
      aria-label="新建笔记类型"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="menu-caption">选择记录的方式</div>
      <button role="menuitem" onClick={() => void create("md")}>
        <FileText size={16} />
        <span>
          Markdown<small>有条理地组织想法</small>
        </span>
        <kbd>.md</kbd>
      </button>
      <button role="menuitem" onClick={() => void create("txt")}>
        <FileText size={16} />
        <span>
          纯文本<small>简单，直接，自由记录</small>
        </span>
        <kbd>.txt</kbd>
      </button>
    </div>
  );
  return (
    <div
      className={`app ${p.sidebarCollapsed ? "sidebar-collapsed" : ""} ${window.xnote ? "native-app" : ""}`}
      style={
        {
          "--sidebar-width": `${widths?.sidebar ?? p.sidebarWidth}px`,
          "--list-width": `${widths?.list ?? p.listWidth}px`,
        } as React.CSSProperties
      }
    >
      <WindowControls />
      <aside className="sidebar">
        <div className="sidebar-top drag-region">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void changeView("all");
            }}
          >
            <span className="brand-name">xnote</span>
          </a>
        </div>
        <nav className="main-nav" aria-label="笔记分类">
          {(
            [
              ["all", Files, "全部笔记", notes.length],
              ["recent", CalendarDays, "最近编辑", null],
              ["favorites", Bookmark, "收藏夹", favorites.length],
              ["templates", LayoutTemplate, "模板", null],
            ] as const
          ).map(([key, Icon, label, count]) => (
            <button
              key={key}
              aria-label={label}
              title={label}
              aria-current={view === key && !query ? "page" : undefined}
              className={`${view === key && !query ? "selected" : ""} ${key === "templates" ? "template-navigation" : ""}`}
              onClick={() => void changeView(key)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {count !== null && <span className="nav-count">{count}</span>}
            </button>
          ))}
        </nav>
        <button
          className="compact-folders icon-button"
          aria-label="浏览文件夹"
          title="浏览文件夹"
          onClick={() => {
            void w.updatePreferences({ sidebarCollapsed: false });
          }}
        >
          <Folder size={16} />
        </button>
        <div className="folder-heading">
          <span className="folder-section-label">文件夹</span>
          <button
            className="icon-button"
            aria-label="新建文件夹"
            title="新建文件夹"
            onClick={() => openFolderDialog({ kind: "folder" })}
          >
            <FolderPlus size={16} />
          </button>
        </div>
        <nav className="folder-nav" aria-label="文件夹">
          {snapshot?.folders.length ? (
            snapshot.folders
              .filter(
                (path) =>
                  !path
                    .split("/")
                    .slice(0, -1)
                    .some((_, i, parts) =>
                      collapsedFolders.has(parts.slice(0, i + 1).join("/")),
                    ),
              )
              .map((path) => {
                const hasChildren = snapshot.folders.some((child) =>
                  child.startsWith(`${path}/`),
                );
                const expanded = !collapsedFolders.has(path);
                return (
                  <div
                    key={path}
                    className={`folder-row ${folder === path ? "selected" : ""}`}
                    style={{ paddingLeft: (path.split("/").length - 1) * 14 }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContext({
                        x: e.clientX,
                        y: e.clientY,
                        folder: path,
                      });
                    }}
                  >
                    {hasChildren ? (
                      <button
                        className="folder-disclosure"
                        aria-label={`${expanded ? "收起" : "展开"}文件夹 ${path}`}
                        aria-expanded={expanded}
                        onClick={() =>
                          setCollapsedFolders((previous) => {
                            const next = new Set(previous);
                            if (next.has(path)) next.delete(path);
                            else next.add(path);
                            return next;
                          })
                        }
                      >
                        <ChevronRight
                          size={12}
                          className={expanded ? "is-open" : ""}
                        />
                      </button>
                    ) : (
                      <span className="folder-disclosure-spacer" />
                    )}
                    <button
                      className="folder-select"
                      aria-label={path}
                      title={path}
                      aria-current={folder === path ? "page" : undefined}
                      onClick={() => void changeView(`folder:${path}`)}
                    >
                      <Folder size={16} />
                      <span>{path.split("/").pop()}</span>
                      <span className="nav-count">
                        {notes.filter((n) => n.folder === path).length || ""}
                      </span>
                    </button>
                  </div>
                );
              })
          ) : (
            <p className="no-folders">还没有文件夹</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div
            className="local-status"
            title={snapshot?.config.root || "本地存储"}
          >
            <span className="status-dot" />
            <span>本地存储</span>
          </div>
          <div className="settings-row">
            <button
              className="settings-button"
              aria-label="设置"
              onClick={() => setSettings(true)}
            >
              <SettingsIcon size={16} />
              <span>设置</span>
            </button>
            <button
              className="icon-button no-drag collapse-button"
              title={p.sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
              aria-label={p.sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
              onClick={() =>
                void w.updatePreferences({
                  sidebarCollapsed: !p.sidebarCollapsed,
                })
              }
            >
              <PanelLeft size={16} />
            </button>
          </div>
        </div>
        <div
          className="column-resizer sidebar-resizer"
          role="separator"
          aria-label="调整侧边栏宽度"
          aria-orientation="vertical"
          tabIndex={0}
          aria-valuemin={160}
          aria-valuemax={360}
          aria-valuenow={widths?.sidebar ?? p.sidebarWidth}
          onKeyDown={(e) => resizeKeyboard("sidebar", e)}
          onPointerDown={(e) => resize("sidebar", e)}
        />
      </aside>
      <section className="note-list-panel">
        <div className="list-top drag-region">
          <span className="workspace-label">我的笔记</span>
          <button
            className="icon-button no-drag"
            title="新建笔记"
            aria-label="新建笔记"
            aria-haspopup="menu"
            aria-expanded={newMenu}
            onClick={toggleNewMenu}
          >
            <Plus size={16} />
          </button>
          {newMenu && newNoteMenu}
        </div>
        <div className="search-box">
          <Search size={14} />
          <input
            ref={searchRef}
            aria-label="搜索笔记"
            placeholder="搜索笔记"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (view === "templates") setView("all");
            }}
          />
          {query ? (
            <button
              aria-label="清除搜索"
              className="icon-button"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        <div className="list-heading">
          <div>
            <h1>{viewTitle}</h1>
            <span>
              {visible.length} 篇{query ? "匹配笔记" : "笔记"}
              {view === "recent" && !query ? " · 近 7 天" : ""}
            </span>
          </div>
          <button
            className="icon-button"
            title={sortNewest ? "最新修改在前" : "最早修改在前"}
            aria-label="切换排序"
            onClick={() => setSortNewest(!sortNewest)}
          >
            <ArrowDownWideNarrow
              size={16}
              style={{ transform: sortNewest ? "none" : "scaleY(-1)" }}
            />
          </button>
        </div>
        <div className="note-items">
          {!snapshot ? (
            <div className="list-empty">
              <LoaderCircle className="spin" size={16} />
              <p>正在读取本地文件…</p>
            </div>
          ) : visible.length ? (
            visible.map((note) => {
              let preview = note.preview;
              const q = query.trim();
              if (q) {
                const index = note.content
                  .toLocaleLowerCase()
                  .indexOf(q.toLocaleLowerCase());
                if (index >= 0)
                  preview =
                    (index > 30 ? "…" : "") +
                    note.content
                      .slice(Math.max(0, index - 30), index + 100)
                      .replace(/\n/g, " ");
              }
              return (
                <article
                  key={note.path}
                  className={`note-item ${draft?.note.path === note.path ? "active" : ""}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContext({ x: e.clientX, y: e.clientY, note });
                  }}
                >
                  <button
                    className="note-select"
                    aria-label={`打开笔记 ${note.title}`}
                    aria-current={
                      draft?.note.path === note.path ? "page" : undefined
                    }
                    onClick={() => void openNote(note.path)}
                  >
                    <div className="note-item-title">
                      <span>
                        <Highlight text={note.title} query={q} />
                      </span>
                      {favorites.includes(note.path) && (
                        <Star size={12} fill="currentColor" />
                      )}
                    </div>
                    <p>
                      <Highlight
                        text={preview || "还没有内容，写点什么吧…"}
                        query={q}
                      />
                    </p>
                    <div className="note-item-meta">
                      <time>{dateLabel(note.modifiedAt)}</time>
                      {note.folder && (
                        <span className="item-folder">
                          <Folder size={12} />
                          {note.folder}
                        </span>
                      )}
                      <span className="type-badge">
                        {note.type === "txt"
                          ? "TXT"
                          : note.noteType === "qa"
                            ? "Q&A"
                            : "MD"}
                      </span>
                    </div>
                  </button>
                  <button
                    className="icon-button note-more"
                    aria-label={`更多操作：${note.title}`}
                    title="更多操作"
                    onClick={(e) => {
                      e.stopPropagation();
                      const box = e.currentTarget.getBoundingClientRect();
                      setContext({
                        x: box.right - 190,
                        y: box.bottom + 4,
                        note,
                      });
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </article>
              );
            })
          ) : (
            <div className="list-empty">
              {query ? (
                <Search size={16} />
              ) : view === "favorites" ? (
                <Star size={16} />
              ) : (
                <FileText size={16} />
              )}
              <p>
                {query
                  ? "没有找到相关笔记"
                  : view === "favorites"
                    ? "收藏值得常读的笔记"
                    : "这里还是空的"}
              </p>
              <span>
                {query
                  ? "换一个关键词试试"
                  : view === "favorites"
                    ? "点击笔记右上方的星标即可收藏"
                    : "点击新建，开始第一篇记录"}
              </span>
            </div>
          )}
        </div>
        <footer className="list-footer">
          <Folder size={12} />
          <span title={snapshot?.config.root}>
            {query
              ? "搜索全部笔记"
              : snapshot?.config.root.split(/[\\/]/).pop() || "本地文件"}
          </span>
        </footer>
        <div
          className="column-resizer list-resizer"
          role="separator"
          aria-label="调整笔记列表宽度"
          aria-orientation="vertical"
          tabIndex={0}
          aria-valuemin={220}
          aria-valuemax={520}
          aria-valuenow={widths?.list ?? p.listWidth}
          onKeyDown={(e) => resizeKeyboard("list", e)}
          onPointerDown={(e) => resize("list", e)}
        />
      </section>
      <main className="editor-panel">
        <div className="editor-topbar drag-region">
          <div className="breadcrumb">
            {view === "templates" ? (
              <LayoutTemplate size={14} />
            ) : (
              <Folder size={14} />
            )}
            <span>
              {view === "templates"
                ? "模板"
                : draft
                  ? draft.note.folder || "我的笔记"
                  : "我的笔记"}
            </span>
            {draft && view !== "templates" && (
              <>
                <ChevronRight size={12} />
                <span title={draft.note.path}>
                  {draft.note.path.split("/").pop()}
                </span>
              </>
            )}
          </div>
          <div className="editor-actions no-drag">
            {draft && view !== "templates" && (
              <>
                <TooltipButton
                  className={`icon-button ${favorites.includes(draft.note.path) ? "favorited" : ""}`}
                  aria-label={
                    favorites.includes(draft.note.path)
                      ? "取消收藏"
                      : "收藏笔记"
                  }
                  title={
                    favorites.includes(draft.note.path)
                      ? "取消收藏"
                      : "收藏笔记"
                  }
                  onClick={() => void favorite(draft.note)}
                >
                  <Star
                    size={16}
                    fill={
                      favorites.includes(draft.note.path)
                        ? "currentColor"
                        : "none"
                    }
                  />
                </TooltipButton>
                <span className="toolbar-divider" />
                <TooltipButton
                  className="icon-button"
                  title="笔记操作"
                  aria-label="笔记操作"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNoteMenu(!noteMenu);
                  }}
                >
                  <MoreHorizontal size={16} />
                </TooltipButton>
                {noteMenu && (
                  <div
                    className="popover note-popover"
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      role="menuitem"
                      onClick={() => {
                        setNoteMenu(false);
                        titleRef.current?.focus();
                        titleRef.current?.select();
                      }}
                    >
                      <PenLine size={14} />
                      重命名
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setNoteMenu(false);
                        void w.saveCopy();
                      }}
                    >
                      <FileText size={14} />
                      另存为副本
                    </button>
                    <button
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        setNoteMenu(false);
                        setDialog({ kind: "delete", note: draft.note });
                      }}
                    >
                      <Trash2 size={14} />
                      删除笔记
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {w.error && (
          <div
            className={`notice ${w.conflict ? "conflict" : ""}`}
            role="alert"
          >
            <CloudOff size={16} />
            <span>{w.error.replace("CONFLICT:", "")}</span>
            {w.conflict ? (
              <>
                <button onClick={() => void w.saveCopy()}>保留为副本</button>
                <button onClick={() => setDialog({ kind: "reload" })}>
                  载入磁盘版本
                </button>
              </>
            ) : (
              <button
                className="icon-button"
                aria-label="关闭提示"
                onClick={() => w.setError("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
        {snapshot?.warnings.map((warning, index) => (
          <div className="notice warning" key={index}>
            <span>{warning}</span>
            <button onClick={() => setSettings(true)}>检查目录</button>
          </div>
        ))}
        {view === "templates" && (
          <TemplateCenter
            disabled={!snapshot || w.transitioning}
            onUse={(template) =>
              void create(template.fileExtension, template.templateId)
            }
          />
        )}
        <div className="note-document" hidden={view === "templates"}>
          {draft ? (
            <>
              <div className="document-header">
                <input
                  ref={titleRef}
                  className="document-title"
                  disabled={w.transitioning}
                  aria-label="笔记标题"
                  placeholder="Untitled"
                  value={draft.title}
                  spellCheck={false}
                  onChange={(e) => w.edit({ title: e.target.value })}
                  onBlur={() => {
                    if (draft.title.trim()) void w.save();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void w.save();
                      setFocusToken((n) => n + 1);
                    }
                  }}
                />
                <div className="document-subtitle">
                  <span>
                    修改于{" "}
                    {new Date(draft.note.modifiedAt).toLocaleString("zh-CN", {
                      month: "long",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
              <div className="document-editor">
                <Suspense
                  fallback={
                    <div className="editor-loading">正在打开编辑器…</div>
                  }
                >
                  <NoteEditor
                    note={draft.note}
                    content={draft.content}
                    onChange={(value) => w.edit({ content: value })}
                    fontSize={p.fontSize}
                    fontFamily={p.fontFamily}
                    dark={dark}
                    focusToken={focusToken}
                    readOnly={w.transitioning}
                  />
                </Suspense>
              </div>
              <footer className="editor-footer">
                <button
                  aria-live="polite"
                  className={`save-indicator ${w.status}`}
                  onClick={() => void w.save()}
                  title="手动保存 ⌘S"
                >
                  {w.status === "saving" ? (
                    <LoaderCircle size={12} className="spin" />
                  ) : w.status === "error" ? (
                    <CloudOff size={12} />
                  ) : (
                    <Check size={12} />
                  )}
                  <span>
                    {w.status === "saved"
                      ? "所有更改已保存"
                      : w.status === "saving"
                        ? "正在保存…"
                        : w.status === "error"
                          ? "保存失败 · 点击重试"
                          : "等待保存…"}
                  </span>
                </button>
                <div>
                  <span>
                    {draft.content.replace(/\s/g, "").length.toLocaleString()}{" "}
                    字
                  </span>
                  <span className="footer-divider" />
                  <span>UTF-8</span>
                  <span className="type-badge">.{draft.note.type}</span>
                </div>
              </footer>
            </>
          ) : (
            <div className="welcome">
              <Notebook size={16} className="welcome-mark" aria-hidden="true" />
              <h2>给想法一个落脚点</h2>
              <p>选择一篇笔记，或写下新的想法。</p>
              <div className="welcome-buttons">
                <button
                  className="primary-button"
                  onClick={() => void create(p.defaultType)}
                >
                  <Plus size={16} />
                  写下第一笔<kbd>⌘ N</kbd>
                </button>
                <button
                  className="text-button"
                  onClick={() => setSettings(true)}
                >
                  <FolderOpen size={14} />
                  选择笔记目录
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      {context && (
        <div
          className="popover context-menu"
          role="menu"
          style={{
            left: Math.min(context.x, window.innerWidth - 220),
            top: Math.min(context.y, window.innerHeight - 180),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {context.note ? (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  void openNote(context.note!.path);
                  setContext(null);
                }}
              >
                <FileText size={14} />
                打开笔记
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  void favorite(context.note!);
                  setContext(null);
                }}
              >
                <Star size={14} />
                {favorites.includes(context.note.path)
                  ? "取消收藏"
                  : "收藏笔记"}
              </button>
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  setDialog({ kind: "delete", note: context.note! });
                  setContext(null);
                }}
              >
                <Trash2 size={14} />
                删除笔记
              </button>
            </>
          ) : (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  openFolderDialog({ kind: "folder", path: context.folder });
                  setContext(null);
                }}
              >
                <FolderPlus size={14} />
                新建子文件夹
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  openFolderDialog({
                    kind: "renameFolder",
                    path: context.folder!,
                  });
                  setContext(null);
                }}
              >
                <PenLine size={14} />
                重命名文件夹
              </button>
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  openFolderDialog({
                    kind: "deleteFolder",
                    path: context.folder!,
                  });
                  setContext(null);
                }}
              >
                <Trash2 size={14} />
                删除空文件夹
              </button>
            </>
          )}
        </div>
      )}
      {settings && snapshot && (
        <Suspense fallback={null}>
          <Settings
            snapshot={snapshot}
            onClose={() => setSettings(false)}
            onPreferences={w.updatePreferences}
            onRoot={async (...args) => {
              const success = await w.changeRoot(...args);
              if (success) {
                setView("all");
                setQuery("");
              }
              return success;
            }}
            onError={w.setError}
          />
        </Suspense>
      )}
      {dialog && (
        <Modal
          title={
            dialog.kind === "folder"
              ? "新建文件夹"
              : dialog.kind === "renameFolder"
                ? "重命名文件夹"
                : dialog.kind === "deleteFolder"
                  ? "删除文件夹"
                  : dialog.kind === "reload"
                    ? "载入磁盘版本"
                    : "删除笔记"
          }
          onClose={() => {
            if (!dialogBusy) setDialog(null);
          }}
          className="small-modal"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitDialog();
            }}
          >
            {dialog.kind === "folder" || dialog.kind === "renameFolder" ? (
              <>
                <p className="dialog-description">
                  {dialog.kind === "folder"
                    ? "为一组相关的想法，取一个名字。"
                    : "更改名称后，文件夹内的笔记路径会同步更新。"}
                </p>
                <input
                  autoFocus
                  className="dialog-input"
                  aria-label="文件夹名称"
                  placeholder="文件夹名称"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                />
              </>
            ) : (
              <p className="dialog-description">
                {dialog.kind === "delete"
                  ? `确定永久删除「${dialog.note.title}」？对应的本地文件会被删除，此操作无法撤销。`
                  : dialog.kind === "deleteFolder"
                    ? `确定删除「${dialog.path}」？仅能删除空文件夹。`
                    : "载入磁盘版本将放弃当前编辑的草稿。你也可以先取消并保留草稿副本。"}
              </p>
            )}
            {dialogError && <p className="inline-error">{dialogError}</p>}
            <div className="button-row">
              <button
                type="button"
                className="secondary-button"
                disabled={dialogBusy}
                onClick={() => setDialog(null)}
              >
                取消
              </button>
              <button
                type="submit"
                className={
                  dialog.kind === "delete" || dialog.kind === "deleteFolder"
                    ? "danger-button"
                    : "primary-button"
                }
                disabled={dialogBusy}
              >
                {dialogBusy && <LoaderCircle className="spin" size={14} />}
                {dialog.kind === "folder"
                  ? "创建"
                  : dialog.kind === "renameFolder"
                    ? "保存名称"
                    : dialog.kind === "reload"
                      ? "确认载入"
                      : "删除文件"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
