import {
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export const MAX_LIVE_MARKDOWN_LENGTH = 100_000;

interface TextRange {
  from: number;
  to: number;
}
interface Presentation {
  hidden: TextRange[];
  lines: { from: number; classes: string }[];
}

/** Decorations change only the presentation. The file and CodeMirror history keep exact Markdown. */
export function presentationRanges(
  state: EditorState,
  showSource = false,
): Presentation {
  // Full-tree live decorations are reserved for normal notes; long files retain source editing.
  if (state.doc.length > MAX_LIVE_MARKDOWN_LENGTH)
    return { hidden: [], lines: [] };
  const selectedLines = state.selection.ranges.map((range) => ({
    from: state.doc.lineAt(range.from).number,
    to: state.doc.lineAt(
      range.to > range.from && state.sliceDoc(range.to - 1, range.to) === "\n"
        ? range.to - 1
        : range.to,
    ).number,
  }));
  const touchesSelection = (from: number, to: number) => {
    const first = state.doc.lineAt(from).number;
    const last = state.doc.lineAt(to).number;
    return selectedLines.some(
      (range) => first <= range.to && last >= range.from,
    );
  };
  const hidden: TextRange[] = [];
  const lines = new Map<number, Set<string>>();
  const decorateLine = (from: number, ...classes: string[]) => {
    const start = state.doc.lineAt(from).from;
    if (!lines.has(start)) lines.set(start, new Set());
    for (const name of classes) lines.get(start)!.add(name);
  };
  syntaxTree(state).iterate({
    enter(node) {
      const heading = /^ATXHeading([1-6])$/.exec(node.name);
      if (heading)
        decorateLine(node.from, "cm-md-heading", `cm-md-h${heading[1]}`);
      if (
        node.name === "Blockquote" ||
        node.name === "FencedCode" ||
        node.name === "CodeBlock"
      ) {
        const first = state.doc.lineAt(node.from).number;
        const last = state.doc.lineAt(node.to).number;
        for (let number = first; number <= last; number++) {
          decorateLine(
            state.doc.line(number).from,
            node.name === "Blockquote" ? "cm-md-quote" : "cm-md-code-block",
          );
        }
      }
      if (node.name === "CodeMark" && node.node.parent?.name === "FencedCode") {
        decorateLine(node.from, "cm-md-code-fence");
      }
      if (showSource) return;
      const parent = node.node.parent;
      if (!parent || touchesSelection(parent.from, parent.to)) return;
      const headingMarker =
        node.name === "HeaderMark" && /^ATXHeading/.test(parent.name);
      const inlineMarker =
        node.name === "EmphasisMark" ||
        (node.name === "CodeMark" && parent.name === "InlineCode");
      const quoteMarker = node.name === "QuoteMark";
      if (headingMarker || inlineMarker || quoteMarker) {
        const includeSpace =
          (headingMarker || quoteMarker) &&
          state.sliceDoc(node.to, node.to + 1) === " ";
        hidden.push({ from: node.from, to: node.to + (includeSpace ? 1 : 0) });
      }
    },
  });
  return {
    hidden,
    lines: [...lines.entries()]
      .sort(([a], [b]) => a - b)
      .map(([from, classes]) => ({ from, classes: [...classes].join(" ") })),
  };
}

function decorations(state: EditorState, showSource: boolean): DecorationSet {
  const ranges = presentationRanges(state, showSource);
  return Decoration.set(
    [
      ...ranges.lines.map((line) =>
        Decoration.line({ class: line.classes }).range(line.from),
      ),
      ...ranges.hidden.map((range) =>
        Decoration.mark({ class: "cm-md-hidden-marker" }).range(
          range.from,
          range.to,
        ),
      ),
    ],
    true,
  );
}

export function markdownPresentation(showSource = false): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => decorations(state, showSource),
    update: (value, transaction) =>
      transaction.docChanged ||
      transaction.selection ||
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
        ? decorations(transaction.state, showSource)
        : value,
    provide: (field) => EditorView.decorations.from(field),
  });
}
