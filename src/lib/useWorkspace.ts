import { useCallback, useEffect, useRef, useState } from "react";
import { api, message } from "./api";
import { NOTE_TEMPLATES } from "./noteTemplates";
import type { Note, Snapshot, Preferences } from "../types";

interface Draft {
  note: Note;
  content: string;
  title: string;
}
const draftKey = (root: string, path: string) => `xnote:draft:${root}:${path}`;
const isDirty = (draft: Draft | null) =>
  !!draft &&
  (draft.content !== draft.note.content || draft.title !== draft.note.title);

export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const [status, setStatus] = useState<"saved" | "saving" | "dirty" | "error">(
    "saved",
  );
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const current = useRef<Draft | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  const flight = useRef<Promise<boolean> | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const publish = useCallback((value: Draft | null) => {
    current.current = value;
    setDraftState(value);
  }, []);
  const apply = useCallback((value: Snapshot) => {
    snapRef.current = value;
    setSnapshot(value);
  }, []);

  function removeStored(root: string, path: string) {
    try {
      localStorage.removeItem(draftKey(root, path));
    } catch {}
  }
  function persist(value: Draft, root = snapRef.current?.config.root) {
    if (!root) return;
    if (!isDirty(value)) {
      removeStored(root, value.note.path);
      return;
    }
    try {
      localStorage.setItem(
        draftKey(root, value.note.path),
        JSON.stringify(value),
      );
    } catch {}
  }
  function beginTransition() {
    if (busy.current) return false;
    // Acquire synchronously, before the first await, so rapid actions cannot overlap.
    busy.current = true;
    generation.current++;
    setTransitioning(true);
    return true;
  }
  function endTransition() {
    busy.current = false;
    setTransitioning(false);
  }
  const remember = async (path: string | null) => {
    const root = snapRef.current?.config.root;
    try {
      const config = await api.updatePreferences({ lastNote: path });
      const currentSnapshot = snapRef.current;
      if (
        currentSnapshot &&
        currentSnapshot.config.root === root &&
        config.root === root
      )
        apply({ ...currentSnapshot, config });
    } catch (error) {
      setError(message(error));
    }
  };
  const refresh = useCallback(async () => {
    const version = generation.current;
    const value = await api.snapshot();
    if (version === generation.current) apply(value);
    return value;
  }, [apply]);

  const save = useCallback(async (): Promise<boolean> => {
    if (flight.current) {
      const success = await flight.current;
      if (!success) return false;
      return isDirty(current.current) ? save() : true;
    }
    if (!isDirty(current.current)) return true;
    const root = snapRef.current!.config.root;
    // Invalidate snapshots captured before this write, even if they return after it finishes.
    generation.current++;
    setStatus("saving");
    // Starting in a microtask installs flight before any synchronous failure can finish it.
    const operation = Promise.resolve().then(async () => {
      try {
        do {
          while (isDirty(current.current)) {
            const captured = current.current!;
            let result = captured.note;
            const advance = (note: Note, normalizeTitle = false) => {
              const latest = current.current;
              if (!latest || latest.note.path !== result.path)
                throw new Error("笔记已切换，已停止保存。草稿仍被保留。");
              const next = {
                note,
                content: latest.content,
                title:
                  normalizeTitle && latest.title === captured.title
                    ? note.title
                    : latest.title,
              };
              const oldPath = result.path;
              result = note;
              publish(next);
              if (oldPath !== note.path) removeStored(root, oldPath);
              persist(next, root);
            };
            if (captured.content !== result.content) {
              const saved = await api.saveNote(
                result.path,
                captured.content,
                result.revision,
              );
              // A later rename may fail. Keep the successful body write's revision immediately.
              advance(saved);
            }
            const title = captured.title.trim();
            if (title !== result.title) {
              const renamed = await api.renameNote(
                result.path,
                title,
                result.revision,
              );
              advance(renamed, true);
              await remember(renamed.path);
            } else advance(result, true);
          }
          await refresh();
          // Input accepted while the write/index request was pending must also reach disk
          // before callers are permitted to replace the active document.
        } while (isDirty(current.current));
        setStatus("saved");
        setConflict(false);
        setError("");
        return true;
      } catch (error) {
        setError(message(error));
        setConflict(message(error).includes("CONFLICT:"));
        setStatus("error");
        if (current.current) persist(current.current, root);
        return false;
      }
    });
    flight.current = operation;
    try {
      return await operation;
    } finally {
      if (flight.current === operation) flight.current = null;
    }
  }, [publish, refresh]);

  const open = useCallback(
    async (path: string) => {
      if (current.current?.note.path === path) return true;
      if (!beginTransition()) return false;
      try {
        if (!(await save())) return false;
        const note = await api.readNote(path);
        // Also flush before publishing if an already queued editor transaction arrived.
        if (!(await save())) return false;
        const next: Draft = { note, content: note.content, title: note.title };
        let recovered = false,
          recoveredConflict = false;
        try {
          const stored = localStorage.getItem(
            draftKey(snapRef.current!.config.root, path),
          );
          if (stored) {
            const saved = JSON.parse(stored) as Draft;
            if (
              typeof saved.content === "string" &&
              typeof saved.title === "string" &&
              saved.note?.path === path &&
              typeof saved.note.revision === "string" &&
              (saved.content !== note.content || saved.title !== note.title)
            ) {
              next.content = saved.content;
              next.title = saved.title;
              recovered = true;
              recoveredConflict = saved.note.revision !== note.revision;
              if (recoveredConflict) next.note = saved.note;
            }
          }
        } catch {}
        publish(next);
        setConflict(recoveredConflict);
        setStatus(recoveredConflict ? "error" : recovered ? "dirty" : "saved");
        setError(
          recoveredConflict
            ? "已恢复未保存的草稿，但磁盘文件已发生变化。请保留副本或载入磁盘版本。"
            : recovered
              ? "已恢复上次未保存的草稿，请检查后保存。"
              : "",
        );
        await remember(path);
        return true;
      } catch (error) {
        setError(message(error));
        return false;
      } finally {
        endTransition();
      }
    },
    [save, publish],
  );

  useEffect(() => {
    let alive = true;
    void refresh()
      .then(async (value) => {
        if (!alive) return;
        const last = value.config.preferences.restoreLastNote
          ? value.config.preferences.lastNote
          : null;
        if (last && value.notes.some((note) => note.path === last))
          await open(last);
      })
      .catch((error) => setError(message(error)));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(async () => {
      if (busy.current || flight.current) return;
      const version = generation.current;
      try {
        const value = await api.snapshot();
        if (busy.current || flight.current || version !== generation.current)
          return;
        apply(value);
        const active = current.current;
        if (!active) return;
        const disk = value.notes.find((note) => note.path === active.note.path);
        if (!disk) {
          setError("文件已在应用外移动或删除。你的草稿仍保留，可另存为副本。");
          setConflict(true);
          return;
        }
        if (disk.revision !== active.note.revision) {
          if (isDirty(active)) {
            setConflict(true);
            setError("文件已在外部修改。请保留草稿副本，或载入磁盘版本。");
          } else {
            publish({ note: disk, content: disk.content, title: disk.title });
            setStatus("saved");
            setConflict(false);
            setError("");
          }
        }
      } catch (error) {
        setError(message(error));
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [apply, publish]);
  useEffect(() => {
    if (status !== "dirty" || transitioning) return;
    const timer = setTimeout(() => void save(), 650);
    return () => clearTimeout(timer);
  }, [draft, status, save, transitioning]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (isDirty(current.current) || flight.current || busy.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    const cleanup = window.xnote?.onBeforeClose(async () =>
      busy.current ? false : save(),
    );
    return () => {
      window.removeEventListener("beforeunload", before);
      cleanup?.();
    };
  }, [save]);

  function edit(patch: Partial<Pick<Draft, "content" | "title">>) {
    // The UI is inert during transitions; this guards late queued input events too.
    if (busy.current || !current.current) return;
    const next = { ...current.current, ...patch };
    publish(next);
    persist(next);
    setStatus("dirty");
  }
  async function create(type: "md" | "txt", folder = "", templateId?: string) {
    if (!beginTransition()) return false;
    try {
      if (!(await save())) return false;
      const note = await (templateId === undefined
        ? api.createNote(type, folder)
        : api.createNote(type, folder, templateId));
      if (!(await save())) return false;
      publish({ note, content: note.content, title: note.title });
      setStatus("saved");
      setConflict(false);
      setError("");
      try {
        await refresh();
      } catch (error) {
        // The file already exists and is editable; a failed index refresh must
        // not invite the user to create the same template a second time.
        setError(`笔记已创建，列表刷新失败：${message(error)}`);
      }
      await remember(note.path);
      return true;
    } catch (error) {
      setError(message(error));
      return false;
    } finally {
      endTransition();
    }
  }
  async function remove(note: Note) {
    if (!beginTransition()) return;
    const active = current.current;
    const confirmedActive =
      active?.note.path === note.path && active.note.revision === note.revision;
    try {
      if (!(await save())) return;
      // Only our own save is allowed to advance the revision that the user confirmed.
      // Never read a fresh disk revision here: that would silently delete external edits.
      const target =
        confirmedActive && current.current ? current.current.note : note;
      await api.deleteNote(target.path, target.revision);
      removeStored(snapRef.current!.config.root, target.path);
      if (current.current?.note.path === target.path) {
        publish(null);
        setStatus("saved");
        setConflict(false);
        await remember(null);
      }
      await refresh();
    } catch (error) {
      setError(message(error));
      setConflict(message(error).includes("CONFLICT:"));
    } finally {
      endTransition();
    }
  }
  async function updatePreferences(patch: Partial<Preferences>) {
    const root = snapRef.current?.config.root;
    try {
      const config = await api.updatePreferences(patch);
      const currentSnapshot = snapRef.current;
      if (
        currentSnapshot &&
        currentSnapshot.config.root === root &&
        config.root === root
      )
        apply({ ...currentSnapshot, config });
    } catch (error) {
      setError(message(error));
    }
  }
  async function changeRoot(root: string, migrate: boolean, create: boolean) {
    if (!beginTransition()) return false;
    try {
      if (!(await save())) return false;
      const value = await api.changeRoot(root, migrate, create);
      publish(null);
      apply(value);
      setStatus("saved");
      setConflict(false);
      setError("");
      return true;
    } catch (error) {
      setError(message(error));
      return false;
    } finally {
      endTransition();
    }
  }
  async function reloadDisk() {
    if (!beginTransition()) return;
    try {
      if (flight.current) await flight.current;
      if (!current.current) return;
      const note = await api.readNote(current.current.note.path);
      removeStored(snapRef.current!.config.root, note.path);
      publish({ note, content: note.content, title: note.title });
      setStatus("saved");
      setConflict(false);
      setError("");
    } catch (error) {
      setError(message(error));
    } finally {
      endTransition();
    }
  }
  async function saveCopy() {
    if (!beginTransition()) return;
    try {
      if (flight.current) await flight.current;
      const active = current.current;
      if (!active) return;
      const templateId =
        active.note.noteType && active.note.noteType !== "markdown"
          ? NOTE_TEMPLATES.find(
              (template) => template.noteType === active.note.noteType,
            )?.templateId
          : undefined;
      const type = active.note.type === "txt" ? "txt" : "md";
      const copy = await (templateId === undefined
        ? api.createNote(type, active.note.folder)
        : api.createNote(type, active.note.folder, templateId));
      let saved = await api.saveNote(copy.path, active.content, copy.revision);
      try {
        saved = await api.renameNote(
          saved.path,
          `${active.title} (副本)`,
          saved.revision,
        );
      } catch {
        /* The uniquely named copy already contains the draft safely. */
      }
      removeStored(snapRef.current!.config.root, active.note.path);
      publish({ note: saved, content: saved.content, title: saved.title });
      setStatus("saved");
      setConflict(false);
      setError("");
      await refresh();
      await remember(saved.path);
    } catch (error) {
      setError(message(error));
    } finally {
      endTransition();
    }
  }
  return {
    snapshot,
    draft,
    status,
    error,
    conflict,
    transitioning,
    setError,
    open,
    edit,
    save,
    create,
    remove,
    refresh,
    updatePreferences,
    changeRoot,
    reloadDisk,
    saveCopy,
  };
}
