import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import {
  markdownPresentation,
  presentationRanges,
} from "../src/components/markdownPresentation";

const create = (doc: string, cursor = doc.length) =>
  EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown(), markdownPresentation()],
  });
const hidden = (state: EditorState, showSource = false) =>
  presentationRanges(state, showSource).hidden.map((range) =>
    state.sliceDoc(range.from, range.to),
  );

describe("Markdown content-first presentation", () => {
  it("hides inactive heading and inline markers without modifying the document", () => {
    const text = "# Heading\n\n**bold** and _italic_ and `code`\n\n";
    const state = create(text);
    expect(hidden(state)).toEqual(["# ", "**", "**", "_", "_", "`", "`"]);
    expect(
      presentationRanges(state).lines.find((line) => line.from === 0)?.classes,
    ).toContain("cm-md-h1");
    expect(state.doc.toString()).toBe(text);
  });
  it("exposes source on the line containing the caret", () => {
    const text = "# Heading\n\n**bold**\n\n";
    const state = create(text, 4);
    expect(hidden(state)).toEqual(["**", "**"]);
    const moved = state.update({
      selection: { anchor: text.indexOf("bold") + 1 },
    }).state;
    expect(hidden(moved)).toEqual(["# "]);
    expect(moved.doc.toString()).toBe(text);
  });
  it("exposes all selected lines including multiline emphasis", () => {
    const text = "# Heading\n**one\ntwo**\n\n";
    const state = create(text).update({
      selection: EditorSelection.range(4, text.indexOf("two") + 2),
    }).state;
    expect(hidden(state)).toEqual([]);
  });
  it("keeps code fences and literal Markdown in code untouched", () => {
    const text = "```md\n# literal **text**\n```\n\n";
    const state = create(text);
    expect(hidden(state)).toEqual([]);
    const lines = presentationRanges(state).lines;
    expect(
      lines.filter((line) => line.classes.includes("cm-md-code-block")),
    ).toHaveLength(3);
    expect(lines.some((line) => line.classes.includes("cm-md-h1"))).toBe(false);
    expect(state.doc.toString()).toBe(text);
  });
  it("uses the source toggle to expose all markers while keeping typography", () => {
    const state = create("## Heading\n\n> Quote\n\n**strong**\n\n");
    expect(hidden(state, true)).toEqual([]);
    expect(
      presentationRanges(state, true).lines.some((line) =>
        line.classes.includes("cm-md-quote"),
      ),
    ).toBe(true);
  });
  it("leaves link destinations, images and list markers editable", () => {
    const state = create(
      "[label](https://example.com)\n![image](asset.png)\n- list\n\n",
    );
    expect(hidden(state)).toEqual([]);
    expect(state.doc.toString()).toContain("https://example.com");
  });
  it("keeps long documents in exact source view instead of rebuilding live decorations", () => {
    const text = "# Heading\n\n**strong** and `code`\n\n".repeat(10000);
    const state = create(text);
    expect(presentationRanges(state).hidden).toHaveLength(0);
    expect(presentationRanges(state).lines).toHaveLength(0);
    const moved = state.update({
      selection: { anchor: text.length - 2 },
    }).state;
    expect(presentationRanges(moved).hidden).toHaveLength(0);
    expect(moved.doc.toString()).toBe(text);
  });
});
