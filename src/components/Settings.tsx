import { useState } from "react";
import {
  FolderOpen,
  Folder,
  Palette,
  Type,
  Keyboard,
  ArrowUpRight,
  Check,
  LoaderCircle,
} from "lucide-react";
import { DEFAULT_PREFERENCES, type Snapshot, type Preferences } from "../types";
import Modal from "./Modal";
export default function Settings({
  snapshot,
  onClose,
  onPreferences,
  onRoot,
  onError,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  onPreferences: (patch: Partial<Preferences>) => Promise<void>;
  onRoot: (root: string, migrate: boolean, create: boolean) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [section, setSection] = useState<"general" | "storage" | "shortcuts">(
    "general",
  );
  const [target, setTarget] = useState(""),
    [mode, setMode] = useState<"switch" | "migrate">("switch"),
    [create, setCreate] = useState(false),
    [confirm, setConfirm] = useState(false),
    [working, setWorking] = useState(false),
    [localError, setLocalError] = useState("");
  const p = snapshot.config.preferences;
  async function choose() {
    try {
      if (window.xnote) {
        const value = await window.xnote.chooseDirectory();
        if (value) setTarget(value);
      } else document.getElementById("storage-path")?.focus();
    } catch (error) {
      setLocalError(String(error));
    }
  }
  async function change() {
    setWorking(true);
    setLocalError("");
    try {
      if (await onRoot(target.trim(), mode === "migrate", create)) {
        setTarget("");
        setConfirm(false);
      } else
        setLocalError(
          "目录切换失败，请查看应用错误提示。原目录和文件仍然保留。",
        );
    } finally {
      setWorking(false);
    }
  }
  return (
    <Modal
      title="设置"
      onClose={() => {
        if (!working) onClose();
      }}
      className="settings-modal"
    >
      <div className="settings-layout">
        <nav className="settings-nav">
          <button
            className={section === "general" ? "active" : ""}
            onClick={() => setSection("general")}
          >
            <Palette size={16} />
            通用
          </button>
          <button
            className={section === "storage" ? "active" : ""}
            onClick={() => setSection("storage")}
          >
            <Folder size={16} />
            文件存储
          </button>
          <button
            className={section === "shortcuts" ? "active" : ""}
            onClick={() => setSection("shortcuts")}
          >
            <Keyboard size={16} />
            快捷键
          </button>
          <span className="settings-version">
            xnote 1.0.0
            <br />
            轻一点，专注一点。
          </span>
        </nav>
        <div className="settings-content">
          {section === "general" && (
            <>
              <h3>让记录更合心意</h3>
              <p className="section-description">
                按自己的习惯，布置这片安静的空间。
              </p>
              <div className="settings-group">
                <label className="setting-row">
                  <span>
                    主题<small>选择应用的外观</small>
                  </span>
                  <select
                    aria-label="主题"
                    value={p.theme}
                    onChange={(e) =>
                      void onPreferences({
                        theme: e.target.value as Preferences["theme"],
                      })
                    }
                  >
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    继续上次的记录<small>启动时打开上次编辑的笔记</small>
                  </span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={p.restoreLastNote}
                    onChange={(e) =>
                      void onPreferences({ restoreLastNote: e.target.checked })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>默认文件类型</span>
                  <select
                    aria-label="默认文件类型"
                    value={p.defaultType}
                    onChange={(e) =>
                      void onPreferences({
                        defaultType: e.target.value as "md" | "txt",
                      })
                    }
                  >
                    <option value="md">Markdown (.md)</option>
                    <option value="txt">纯文本 (.txt)</option>
                  </select>
                </label>
              </div>
              <h4>
                <Type size={14} />
                编辑器
              </h4>
              <div className="settings-group">
                <label className="setting-row">
                  <span>字体</span>
                  <select
                    aria-label="编辑器字体"
                    value={p.fontFamily}
                    onChange={(e) =>
                      void onPreferences({
                        fontFamily: e.target.value as Preferences["fontFamily"],
                      })
                    }
                  >
                    <option value="system">系统默认</option>
                    <option value="serif">衬线字体</option>
                    <option value="mono">等宽字体</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>字号</span>
                  <select
                    aria-label="编辑器字号"
                    value={
                      [12, 14, 16].includes(p.fontSize)
                        ? p.fontSize
                        : DEFAULT_PREFERENCES.fontSize
                    }
                    onChange={(e) =>
                      void onPreferences({ fontSize: Number(e.target.value) })
                    }
                  >
                    {[12, 14, 16].map((n) => (
                      <option key={n} value={n}>
                        {n} px
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}
          {section === "storage" && (
            <>
              <h3>你的笔记，你的文件</h3>
              <p className="section-description">
                以开放的文本格式，保存在你自己的电脑上。
              </p>
              <div className="storage-card">
                <FolderOpen size={16} />
                <div>
                  <strong>笔记保存目录</strong>
                  <code>{snapshot.config.root}</code>
                  <small>
                    {snapshot.notes.length} 篇笔记 · {snapshot.folders.length}{" "}
                    个文件夹
                  </small>
                </div>
                {window.xnote && (
                  <button
                    className="icon-button"
                    aria-label="打开保存目录"
                    onClick={() =>
                      void window
                        .xnote!.openDirectory()
                        .catch((e) => onError(String(e)))
                    }
                  >
                    <ArrowUpRight size={16} />
                  </button>
                )}
              </div>
              <h4>修改保存目录</h4>
              <label className="path-label" htmlFor="storage-path">
                新目录的完整路径
              </label>
              <div className="path-input">
                <input
                  id="storage-path"
                  placeholder="例如 ~/Documents/我的笔记"
                  value={target}
                  disabled={working}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setConfirm(false);
                  }}
                />
                <button
                  className="secondary-button"
                  disabled={working}
                  onClick={() => void choose()}
                >
                  选择文件夹
                </button>
              </div>
              {!window.xnote && (
                <p className="help-text">
                  浏览器开发模式请填写此电脑上的完整目录路径；桌面应用提供原生目录选择。
                </p>
              )}
              <div className="migration-options">
                <label>
                  <input
                    type="radio"
                    name="migration"
                    checked={mode === "switch"}
                    onChange={() => {
                      setMode("switch");
                      setConfirm(false);
                    }}
                  />
                  使用新目录
                  <small>读取新目录中的笔记，原笔记保留在原目录。</small>
                </label>
                <label>
                  <input
                    type="radio"
                    name="migration"
                    checked={mode === "migrate"}
                    onChange={() => {
                      setMode("migrate");
                      setConfirm(false);
                    }}
                  />
                  迁移现有笔记
                  <small>
                    复制并校验全部文件后切换目录；原目录保留备份。同名文件会中止迁移。
                  </small>
                </label>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={create}
                  onChange={(e) => setCreate(e.target.checked)}
                />
                目录不存在时创建
              </label>
              {localError && <p className="inline-error">{localError}</p>}
              {confirm ? (
                <div className="confirm-migration">
                  <p>
                    确认将文件复制到 <strong>{target}</strong> 并切换保存目录？
                  </p>
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      disabled={working}
                      onClick={() => setConfirm(false)}
                    >
                      取消
                    </button>
                    <button
                      className="primary-button"
                      disabled={working}
                      onClick={() => void change()}
                    >
                      {working ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Check size={14} />
                      )}
                      确认迁移
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="primary-button"
                  disabled={!target.trim() || working}
                  onClick={() =>
                    mode === "migrate" ? setConfirm(true) : void change()
                  }
                >
                  {working && <LoaderCircle size={14} className="spin" />}
                  {mode === "migrate" ? "继续迁移" : "使用此目录"}
                </button>
              )}
            </>
          )}
          {section === "shortcuts" && (
            <>
              <h3>让想法跟上指尖</h3>
              <p className="section-description">
                macOS 使用 ⌘，Windows / Linux 使用 Ctrl。
              </p>
              <div className="shortcut-table">
                {[
                  ["新建笔记", "⌘ N"],
                  ["搜索全部笔记", "⌘ P / ⌘ K"],
                  ["保存笔记", "⌘ S"],
                  ["设置", "⌘ ,"],
                  ["折叠侧边栏", "⌘ \\"],
                  ["粗体 / 斜体", "⌘ B / ⌘ I"],
                  ["撤销 / 重做", "⌘ Z / ⌘ ⇧ Z"],
                  ["全选", "⌘ A"],
                ].map(([label, key]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <kbd>{key}</kbd>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
