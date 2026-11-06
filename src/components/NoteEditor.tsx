import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { tags } from "@lezer/highlight";
import ReactMarkdown, { type Components } from "react-markdown";
import PreviewImage, { previewImageUrl } from "./PreviewImage";
import TooltipButton from "./TooltipButton";
import remarkGfm from "remark-gfm";
import remarkLineBreaks from "./remarkLineBreaks";
import {
  Bold,
  Italic,
  Heading2,
  Link2,
  List,
  Code2,
  Quote,
  Image,
  Code,
  Minus,
  Pencil,
  Eye,
  Columns2,
  Braces,
} from "lucide-react";
import { DEFAULT_PREFERENCES, type Note } from "../types";
import "./editor.css";
import {
  markdownPresentation,
  MAX_LIVE_MARKDOWN_LENGTH,
} from "./markdownPresentation";

export interface NoteEditorProps {
  note: Note;
  content: string;
  onChange: (value: string) => void;
  fontSize: number;
  fontFamily: "system" | "serif" | "mono";
  dark: boolean;
  focusToken: number;
  readOnly?: boolean;
}

type Format =
  | "bold"
  | "italic"
  | "heading"
  | "link"
  | "list"
  | "code"
  | "quote"
  | "image"
  | "divider"
  | "inline";
interface MarkdownEdit {
  from: number;
  to: number;
  insert: string;
  selection: { anchor: number; head: number };
}

type InlineSyntaxNode = ReturnType<
  typeof markdownLanguage.parser.parse
>["topNode"];

const inlineNodes = {
  bold: "StrongEmphasis",
  italic: "Emphasis",
  inline: "InlineCode",
};

function inlineRange(
  content: string,
  from: number,
  to: number,
  kind: keyof typeof inlineNodes,
) {
  let found:
    | {
        from: number;
        to: number;
        open: number;
        close: number;
        node: InlineSyntaxNode;
      }
    | undefined;
  markdownLanguage.parser.parse(content).iterate({
    enter(node) {
      if (node.name !== inlineNodes[kind] || node.from > from || node.to < to)
        return;
      const first = node.node.firstChild;
      const last = node.node.lastChild;
      if (!first || !last || first === last) return;
      // A collapsed caret just outside a delimiter is not inside the format.
      if (from === to && (from < first.to || to > last.from)) return;
      found = {
        from: node.from,
        to: node.to,
        open: first.to,
        close: last.from,
        node: node.node,
      };
    },
  });
  return found;
}

function activeFormats(state: EditorState): Format[] {
  const { from, to } = state.selection.main;
  const active = new Set<Format>();
  // Inspect only ancestors at the selection, never walk a long document on each keystroke.
  let node = syntaxTree(state).resolveInner(from, from === to ? -1 : 1);
  while (true) {
    if (node.from <= from && node.to >= to) {
      if (node.name === "StrongEmphasis") active.add("bold");
      if (node.name === "Emphasis") active.add("italic");
      if (/^ATXHeading/.test(node.name)) active.add("heading");
      if (node.name === "BulletList" || node.name === "OrderedList")
        active.add("list");
      if (node.name === "Blockquote") active.add("quote");
      if (node.name === "Link") active.add("link");
      if (node.name === "FencedCode" || node.name === "CodeBlock")
        active.add("code");
    }
    if (!node.parent) break;
    node = node.parent;
  }
  return [...active];
}

/** Let Markdown's keymap continue lists/quotes/code; plain Enter adds one newline. */
function insertMarkdownBreak(view: EditorView, soft = false): boolean {
  if (view.composing || view.state.readOnly) return false;
  const { state } = view;
  const { from, to } = state.selection.main;
  let node = syntaxTree(state).resolveInner(from, -1);
  while (node.parent) {
    if (
      [
        "FencedCode",
        "CodeBlock",
        "BulletList",
        "OrderedList",
        "Blockquote",
      ].includes(node.name)
    )
      return false;
    node = node.parent;
  }
  const insert = soft ? "  \n" : "\n";
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

/** A single editor transaction keeps each formatting operation undoable. */
export function markdownEdit(
  content: string,
  from: number,
  to: number,
  kind: Format,
): MarkdownEdit {
  if (kind === "bold" || kind === "italic" || kind === "inline") {
    // Delimiters touching whitespace do not produce CommonMark emphasis.
    const selection = content.slice(from, to);
    if (selection.trim()) {
      from += selection.length - selection.trimStart().length;
      to -= selection.length - selection.trimEnd().length;
    }
    const range = inlineRange(content, from, to, kind);
    if (range) {
      const text = content.slice(range.open, range.close);
      if (from !== to) {
        const start = Math.max(range.open, from);
        const end = Math.min(range.close, to);
        const opening =
          kind === "inline"
            ? content.slice(range.from, range.open)
            : kind === "bold"
              ? "**"
              : "*";
        const closing =
          kind === "inline" ? content.slice(range.close, range.to) : opening;
        const wrap = (value: string, open = opening, close = closing) =>
          value.replace(
            /^(\s*)([\s\S]*?\S)(\s*)$/,
            (_, lead, middle, tail) => lead + open + middle + close + tail,
          );
        // Close and reopen nested emphasis at each boundary, so no run contains orphaned delimiters.
        const render = (
          node: InlineSyntaxNode,
          lower: number,
          upper: number,
          omitTarget = false,
          italicMarker = "*",
        ): string => {
          const left = Math.max(node.from, lower),
            right = Math.min(node.to, upper);
          if (left >= right || node.name === "EmphasisMark") return "";
          let value = "",
            position = node.from;
          for (let child = node.firstChild; child; child = child.nextSibling) {
            value += content.slice(
              Math.max(position, left),
              Math.max(Math.max(position, left), Math.min(child.from, right)),
            );
            value += render(child, lower, upper, false, italicMarker);
            position = child.to;
          }
          value += content.slice(
            Math.max(position, left),
            Math.max(Math.max(position, left), right),
          );
          if (omitTarget && node === range.node) return value;
          if (node.name === "Emphasis")
            return wrap(value, italicMarker, italicMarker);
          if (node.name === "StrongEmphasis") return wrap(value, "**", "**");
          if (node.name === "InlineCode") {
            const marker = content.slice(node.from, node.firstChild!.to);
            return wrap(value, marker, marker);
          }
          return value;
        };
        const before = render(range.node, range.open, start);
        const after = render(range.node, end, range.close);
        let selected = render(range.node, start, end, true);
        // Four-star junctions are interpreted differently by Lezer and CommonMark.
        // At punctuation-delimited boundaries, underscores keep retained italic unambiguous.
        const left = (before || content.slice(0, range.from)).slice(-1);
        const right = (after || content.slice(range.to)).slice(0, 1);
        if (
          kind === "bold" &&
          !/[\p{L}\p{N}]/u.test(left) &&
          !/[\p{L}\p{N}]/u.test(right) &&
          ((before.endsWith("*") && selected.startsWith("*")) ||
            (selected.endsWith("*") && after.startsWith("*")))
        ) {
          selected = render(range.node, start, end, true, "_");
        }
        return {
          from: range.from,
          to: range.to,
          insert: before + selected + after,
          selection: {
            anchor: range.from + before.length,
            head: range.from + before.length + selected.length,
          },
        };
      }
      const map = (position: number) =>
        range.from + Math.max(0, Math.min(text.length, position - range.open));
      return {
        from: range.from,
        to: range.to,
        insert: text,
        selection: { anchor: map(from), head: map(to) },
      };
    }
  }
  const selected = content.slice(from, to);
  if (kind === "heading" || kind === "list" || kind === "quote") {
    const lineFrom = from === 0 ? 0 : content.lastIndexOf("\n", from - 1) + 1;
    const rangeEnd = to > from && content[to - 1] === "\n" ? to - 1 : to;
    const newline = content.indexOf("\n", rangeEnd);
    const lineTo = newline === -1 ? content.length : newline;
    const lines = content.slice(lineFrom, lineTo).split("\n");
    const prefix = kind === "heading" ? "## " : kind === "list" ? "- " : "> ";
    const remove = lines.every((line) => line.startsWith(prefix));
    const insert = lines
      .map((line) =>
        remove
          ? line.slice(prefix.length)
          : prefix +
            (kind === "heading" ? line.replace(/^#{1,6}\s/, "") : line),
      )
      .join("\n");
    return {
      from: lineFrom,
      to: lineTo,
      insert,
      selection: { anchor: lineFrom, head: lineFrom + insert.length },
    };
  }
  if (kind === "divider") {
    const insert = `${from && content[from - 1] !== "\n" ? "\n\n" : ""}---\n\n`;
    return {
      from,
      to,
      insert,
      selection: { anchor: from + insert.length, head: from + insert.length },
    };
  }
  if (kind === "link" || kind === "image") {
    const label = selected || (kind === "image" ? "图片描述" : "链接文字");
    const opening = kind === "image" ? "![" : "[";
    const insert = `${opening}${label}](https://)`;
    const anchor = from + opening.length + label.length + 2;
    return { from, to, insert, selection: { anchor, head: anchor + 8 } };
  }
  const marker =
    kind === "bold"
      ? "**"
      : kind === "italic"
        ? "*"
        : kind === "inline"
          ? "`"
          : "```\n";
  const closing = kind === "code" ? "\n```" : marker;
  if (
    selected &&
    content.slice(from - marker.length, from) === marker &&
    content.slice(to, to + closing.length) === closing
  ) {
    return {
      from: from - marker.length,
      to: to + closing.length,
      insert: selected,
      selection: { anchor: from - marker.length, head: to - marker.length },
    };
  }
  const label =
    selected || (kind === "code" || kind === "inline" ? "代码" : "文字");
  const before =
    kind === "code" && from > 0 && content[from - 1] !== "\n" ? "\n\n" : "";
  const after =
    kind === "code" && to < content.length && content[to] !== "\n"
      ? "\n\n"
      : "";
  return {
    from,
    to,
    insert: before + marker + label + closing + after,
    selection: {
      anchor: from + before.length + marker.length,
      head: from + before.length + marker.length + label.length,
    },
  };
}

/** Links never receive local paths or active URL schemes. */
export function safePreviewUrl(url: string): string {
  return /^(https?:\/\/|mailto:|#)/i.test(url.trim()) ? url.trim() : "";
}

const externalChange = Annotation.define<boolean>();
const fontFamilies = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  serif: "'Iowan Old Style', 'Palatino Linotype', 'Songti SC', Georgia, serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
};
const markdownStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "600" },
  { tag: tags.heading2, fontWeight: "600" },
  { tag: tags.heading3, fontWeight: "600" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.keyword, color: "var(--text)", fontWeight: "600" },
  { tag: [tags.string, tags.number], color: "var(--muted)" },
  { tag: tags.comment, color: "var(--subtle)", fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "var(--color-content-link)" },
  {
    tag: tags.monospace,
    fontFamily: fontFamilies.mono,
    backgroundColor: "var(--surface)",
    color: "var(--text)",
  },
  {
    tag: [tags.quote, tags.processingInstruction, tags.contentSeparator],
    color: "var(--color-content-muted)",
  },
]);

const javascriptCode = javascript({ jsx: true }).language;
const typescriptCode = javascript({ jsx: true, typescript: true }).language;

function runFormat(view: EditorView, kind: Format): boolean {
  if (view.state.facet(EditorState.readOnly)) return false;
  const { from, to } = view.state.selection.main;
  const { selection, ...changes } = markdownEdit(
    view.state.doc.toString(),
    from,
    to,
    kind,
  );
  view.dispatch({ changes, selection, userEvent: "input" });
  view.focus();
  return true;
}

export function languageExtensions(isMarkdown: boolean): Extension[] {
  return isMarkdown
    ? [
        keymap.of([
          { key: "Enter", run: (view) => insertMarkdownBreak(view) },
          {
            key: "Shift-Enter",
            run: (view) => insertMarkdownBreak(view, true),
          },
          { key: "Mod-b", run: (view) => runFormat(view, "bold") },
          { key: "Mod-i", run: (view) => runFormat(view, "italic") },
          { key: "Mod-k", run: (view) => runFormat(view, "link") },
          { key: "Mod-Shift-7", run: (view) => runFormat(view, "list") },
        ]),
        markdown({
          codeLanguages: (info) => {
            const language = info.trim().split(/\s+/)[0].toLowerCase();
            if (["js", "javascript", "jsx"].includes(language))
              return javascriptCode;
            if (["ts", "typescript", "tsx"].includes(language))
              return typescriptCode;
            return null;
          },
        }),
        syntaxHighlighting(markdownStyle),
      ]
    : [];
}

export default function NoteEditor(props: NoteEditorProps) {
  const {
    note,
    content,
    fontSize,
    fontFamily,
    dark,
    focusToken,
    readOnly = false,
  } = props;
  const [mode, setMode] = useState<"edit" | "preview" | "split">("edit");
  const [showSource, setShowSource] = useState(false);
  const [active, setActive] = useState<Format[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    from: number;
    to: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const editorFontSize = [12, 14, 16].includes(fontSize)
    ? fontSize
    : DEFAULT_PREFERENCES.fontSize;
  const mount = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const latest = useRef(props);
  const cachedStates = useRef(new Map<string, EditorState>());
  const appearance = useRef(new Compartment());
  const language = useRef(new Compartment());
  const editability = useRef(new Compartment());
  const presentation = useRef(new Compartment());
  latest.current = props;
  const isMarkdown = note.type !== "txt";
  const sourceForced = content.length > MAX_LIVE_MARKDOWN_LENGTH;
  const effectiveSource = sourceForced || showSource;
  const previewComponents = useMemo<Components>(
    () => ({
      a: ({ children, href }) => (
        <a href={href || undefined} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
      img: ({ src, alt }) => (
        <PreviewImage folder={note.folder} source={src} alt={alt} />
      ),
    }),
    [note.folder],
  );

  useEffect(() => {
    if (!mount.current) return;
    const savedState = cachedStates.current.get(note.path);
    let state =
      savedState ||
      EditorState.create({
        doc: latest.current.content,
        extensions: [
          history(),
          EditorView.lineWrapping,
          placeholder("从这里开始，写下你的想法…"),
          EditorView.contentAttributes.of({
            "aria-label": "正文",
            "data-testid": "note-body",
            role: "textbox",
            "aria-multiline": "true",
            spellcheck: "false",
          }),
          language.current.of(languageExtensions(note.type !== "txt")),
          appearance.current.of([]),
          presentation.current.of(
            note.type !== "txt" ? markdownPresentation(effectiveSource) : [],
          ),
          editability.current.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged || update.selectionSet) setContextMenu(null);
            if (update.docChanged || update.selectionSet) {
              const next = activeFormats(update.state);
              setActive((previous) =>
                previous.length === next.length &&
                previous.every((kind) => next.includes(kind))
                  ? previous
                  : next,
              );
            }
            if (
              update.docChanged &&
              !update.transactions.some((transaction) =>
                transaction.annotation(externalChange),
              )
            ) {
              latest.current.onChange(update.state.doc.toString());
            }
          }),
        ],
      });
    if (state.doc.toString() !== latest.current.content) {
      state = state.update({
        changes: {
          from: 0,
          to: state.doc.length,
          insert: latest.current.content,
        },
        annotations: externalChange.of(true),
      }).state;
    }
    const view = new EditorView({ state, parent: mount.current });
    editor.current = view;
    setActive(activeFormats(view.state));
    setMode("edit");
    return () => {
      cachedStates.current.set(note.path, view.state);
      // Keep undo history useful without retaining every document for the entire session.
      if (cachedStates.current.size > 20)
        cachedStates.current.delete(cachedStates.current.keys().next().value!);
      view.destroy();
      editor.current = null;
    };
  }, [note.path]);

  useEffect(() => {
    setContextMenu(null);
  }, [note.path, mode, readOnly]);

  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    setMenuPosition({
      left: Math.max(
        8,
        Math.min(contextMenu.x, window.innerWidth - rect.width - 8),
      ),
      top: Math.max(
        8,
        Math.min(contextMenu.y, window.innerHeight - rect.height - 8),
      ),
    });
    menu
      .querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    const dismiss = () => setContextMenu(null);
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) dismiss();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    const scroll = (event: Event) => {
      if (!menu.contains(event.target as Node)) dismiss();
    };
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    editor.current?.dispatch({
      effects: [
        language.current.reconfigure(languageExtensions(isMarkdown)),
        appearance.current.reconfigure(
          EditorView.theme(
            {
              "&": { fontSize: `${editorFontSize}px` },
              ".cm-scroller": { fontFamily: fontFamilies[fontFamily] },
            },
            { dark },
          ),
        ),
      ],
    });
  }, [editorFontSize, fontFamily, dark, isMarkdown, note.path]);

  useEffect(() => {
    editor.current?.dispatch({
      effects: presentation.current.reconfigure(
        isMarkdown ? markdownPresentation(effectiveSource) : [],
      ),
    });
  }, [effectiveSource, isMarkdown, note.path]);

  useEffect(() => {
    editor.current?.dispatch({
      effects: editability.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly, note.path]);

  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== content) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        annotations: externalChange.of(true),
      });
    }
  }, [content, note.path]);

  useEffect(() => {
    if (!focusToken) return;
    setMode("edit");
    const frame = requestAnimationFrame(() => editor.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusToken, note.path]);

  const format = (kind: Format) => {
    if (readOnly) return;
    const view = editor.current;
    if (!view) return;
    if (mode === "preview") {
      setMode("edit");
      requestAnimationFrame(() => {
        if (editor.current === view) runFormat(view, kind);
      });
    } else runFormat(view, kind);
  };
  const formats = [
    { kind: "heading", icon: Heading2, title: "二级标题" },
    { kind: "bold", icon: Bold, title: "粗体 · ⌘B / Ctrl+B" },
    { kind: "italic", icon: Italic, title: "斜体 · ⌘I / Ctrl+I" },
    { kind: "list", icon: List, title: "无序列表" },
    { kind: "quote", icon: Quote, title: "引用" },
    { kind: "link", icon: Link2, title: "插入链接 · ⌘K / Ctrl+K" },
    { kind: "image", icon: Image, title: "插入图片链接" },
    { kind: "code", icon: Code2, title: "代码块" },
    { kind: "divider", icon: Minus, title: "分割线" },
  ] as const;
  const style = {
    "--editor-font": fontFamilies[fontFamily],
    fontSize: `${editorFontSize}px`,
  } as CSSProperties;

  return (
    <section
      className="note-editor"
      style={style}
      aria-label={isMarkdown ? "Markdown 编辑器" : "纯文本编辑器"}
    >
      {isMarkdown && (
        <div className="editor-toolbar">
          <div
            className="editor-formats"
            role="toolbar"
            aria-label="Markdown 格式"
          >
            {formats.map(({ kind, icon: Icon, title }) => (
              <TooltipButton
                key={kind}
                type="button"
                disabled={readOnly}
                title={title}
                aria-label={title.split(" · ")[0]}
                aria-pressed={active.includes(kind)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format(kind)}
              >
                <Icon size={16} />
              </TooltipButton>
            ))}
          </div>
          <div className="editor-mode-switch" aria-label="编辑器视图">
            <TooltipButton
              type="button"
              className="editor-source-toggle"
              aria-label="显示 Markdown 源码"
              title={
                sourceForced
                  ? "长文档使用源码编辑，保持流畅"
                  : showSource
                    ? "隐藏非当前行的 Markdown 标记"
                    : "显示完整 Markdown 源码"
              }
              aria-pressed={effectiveSource}
              disabled={sourceForced}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setShowSource((value) => !value);
                if (mode === "preview") setMode("edit");
              }}
            >
              <Braces size={14} />
            </TooltipButton>
            <TooltipButton
              type="button"
              aria-label="编辑"
              title="编辑"
              aria-pressed={mode === "edit"}
              onClick={() => {
                setMode("edit");
                requestAnimationFrame(() => editor.current?.focus());
              }}
            >
              <Pencil size={14} />
              <span className="editor-mode-label">编辑</span>
            </TooltipButton>
            <TooltipButton
              type="button"
              aria-label="预览"
              title="预览"
              aria-pressed={mode === "preview"}
              onClick={() => setMode("preview")}
            >
              <Eye size={14} />
              <span className="editor-mode-label">预览</span>
            </TooltipButton>
            <TooltipButton
              type="button"
              aria-label="分屏预览"
              title="分屏预览"
              aria-pressed={mode === "split"}
              onClick={() => setMode("split")}
            >
              <Columns2 size={14} />
            </TooltipButton>
          </div>
        </div>
      )}
      <div
        className={`editor-body${mode === "split" && isMarkdown ? " is-split" : ""}`}
      >
        <div
          ref={mount}
          className={`editor-code${mode === "preview" && isMarkdown ? " is-hidden" : ""}`}
          onContextMenu={(event) => {
            const view = editor.current;
            if (!isMarkdown || readOnly || !view || view.composing) return;
            const { from, to } = view.state.selection.main;
            if (from === to) return;
            event.preventDefault();
            event.stopPropagation();
            setContextMenu({ x: event.clientX, y: event.clientY, from, to });
          }}
        />
        {isMarkdown && mode !== "edit" && (
          <article className="markdown-preview" aria-label="Markdown 预览">
            {content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkLineBreaks]}
                urlTransform={(url, key, node) =>
                  node.tagName === "img" && key === "src"
                    ? previewImageUrl(note.folder, url)
                    : safePreviewUrl(url)
                }
                components={previewComponents}
              >
                {content}
              </ReactMarkdown>
            ) : (
              <p className="preview-empty">写下内容，预览将在这里呈现。</p>
            )}
          </article>
        )}
      </div>
      {contextMenu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="文本样式"
            className="popover editor-context-menu"
            style={menuPosition}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setContextMenu(null);
                editor.current?.focus();
              } else if (event.key === "Tab") {
                setContextMenu(null);
              } else if (
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button",
                  ),
                );
                const current = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : (current +
                          (event.key === "ArrowUp" ? -1 : 1) +
                          items.length) %
                        items.length;
                items[next]?.focus();
              }
            }}
          >
            {[
              ...formats,
              { kind: "inline" as const, icon: Code, title: "行内代码" },
            ].map(({ kind, icon: Icon, title }) => (
              <button
                type="button"
                key={kind}
                role="menuitem"
                className={active.includes(kind) ? "active" : ""}
                onClick={() => {
                  const view = editor.current;
                  if (view) {
                    view.dispatch({
                      selection: {
                        anchor: contextMenu.from,
                        head: contextMenu.to,
                      },
                    });
                    runFormat(view, kind);
                  }
                  setContextMenu(null);
                }}
              >
                <Icon size={16} />
                <span>{title.split(" · ")[0]}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </section>
  );
}
