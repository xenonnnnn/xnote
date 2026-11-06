import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, highlightingFor } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import {
  languageExtensions,
  markdownEdit,
  safePreviewUrl,
} from "../src/components/NoteEditor";

describe("Markdown fenced code highlighting", () => {
  it.each(["js", "javascript", "ts", "typescript", "jsx", "tsx"])(
    "highlights %s code without changing the Markdown document",
    (language) => {
      const code =
        language === "ts" || language === "typescript" || language === "tsx"
          ? 'const answer: string = "hello";'
          : 'const answer = "hello";';
      const doc = `# 问题\n\n\`\`\`${language}\n${code}\n\`\`\`\n`;
      const state = EditorState.create({
        doc,
        extensions: languageExtensions(true),
      });
      const tree = ensureSyntaxTree(state, doc.length, 1000)!;
      const tokens: { text: string; style: string }[] = [];
      highlightTree(
        tree,
        { style: (tags) => highlightingFor(state, tags) },
        (from, to, style) => tokens.push({ text: doc.slice(from, to), style }),
      );
      const keyword = tokens.find((token) => token.text === "const");
      const string = tokens.find((token) => token.text === '"hello"');
      expect(keyword).toBeDefined();
      expect(string).toBeDefined();
      expect(keyword!.style).not.toBe(string!.style);
      expect(state.doc.toString()).toBe(doc);
    },
  );
  it("keeps unknown code languages editable and leaves TXT unparsed", () => {
    const doc = '```unknown\nconst answer = "hello";\n```';
    const markdownState = EditorState.create({
      doc,
      extensions: languageExtensions(true),
    });
    const textState = EditorState.create({
      doc,
      extensions: languageExtensions(false),
    });
    expect(
      ensureSyntaxTree(markdownState, doc.length, 1000)!.toString(),
    ).toContain("FencedCode");
    expect(ensureSyntaxTree(textState, doc.length, 1000)).toBeNull();
    expect(markdownState.doc.toString()).toBe(doc);
    expect(textState.doc.toString()).toBe(doc);
  });
});

function apply(
  text: string,
  from: number,
  to: number,
  kind: Parameters<typeof markdownEdit>[3],
) {
  const edit = markdownEdit(text, from, to, kind);
  return {
    ...edit,
    content: text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
  };
}

describe("Markdown toolbar edits", () => {
  it("wraps the selected text without changing surrounding text", () => {
    const edit = apply("a hello z", 2, 7, "bold");
    expect(edit.content).toBe("a **hello** z");
    expect(edit.selection).toEqual({ anchor: 4, head: 9 });
  });
  it("inserts a usable italic placeholder at the caret", () => {
    const edit = apply("", 0, 0, "italic");
    expect(edit.content).toBe("*文字*");
    expect(edit.selection).toEqual({ anchor: 1, head: 3 });
  });
  it("uses valid emphasis inside an English word", () => {
    expect(apply("hello", 1, 4, "italic").content).toBe("h*ell*o");
  });
  it("removes existing emphasis at a caret or over the complete source range", () => {
    expect(apply("a _hello_ z", 5, 5, "italic").content).toBe("a hello z");
    expect(apply("*hello*", 0, 7, "italic").content).toBe("hello");
    expect(apply("**hello**", 4, 4, "bold").content).toBe("hello");
  });
  it("cancels emphasis when the selection includes whitespace or its trailing newline", () => {
    expect(apply("*hello*\n", 0, 8, "italic").content).toBe("hello\n");
    expect(apply(" _hello_ ", 0, 9, "italic").content).toBe(" hello ");
  });
  it("removes only the selected part of an emphasized range", () => {
    expect(apply("*hello world*", 3, 5, "italic").content).toBe(
      "*he*ll*o world*",
    );
    expect(apply("**hello world**", 2, 7, "bold").content).toBe(
      "hello **world**",
    );
  });
  it("preserves nested emphasis when removing only part of one format", () => {
    const first = apply("***hello***", 5, 7, "italic").content;
    const second = apply("**a *hello* z**", 6, 9, "bold").content;
    const render = (text: string) =>
      renderToStaticMarkup(createElement(ReactMarkdown, { children: text }));
    expect(render(first).replace(/<[^>]+>/g, "")).toBe("hello");
    expect(render(first)).toContain("<strong>ll</strong>");
    expect(render(second).replace(/<[^>]+>/g, "")).toBe("a hello z");
    expect(render(second)).toContain("<em>ell</em>");
    const formats = (source: string, text: string) => {
      let node = markdownLanguage.parser
        .parse(source)
        .resolveInner(source.indexOf(text) + 1);
      const names = [];
      while (node.parent) {
        names.push(node.name);
        node = node.parent;
      }
      return names;
    };
    expect(formats(first, "ll")).toContain("StrongEmphasis");
    expect(formats(first, "ll")).not.toContain("Emphasis");
    expect(formats(second, "ell")).toContain("Emphasis");
    expect(formats(second, "ell")).not.toContain("StrongEmphasis");
  });
  it("keeps surrounding whitespace outside emphasis", () => {
    expect(apply(" hello ", 0, 7, "italic").content).toBe(" *hello* ");
  });
  it("keeps fenced code on separate lines within prose", () => {
    expect(apply("before code after", 7, 11, "code").content).toBe(
      "before \n\n```\ncode\n```\n\n after",
    );
  });
  it("toggles prefixes across selected lines", () => {
    const edit = apply("one\ntwo", 0, 7, "list");
    expect(edit.content).toBe("- one\n- two");
    expect(apply(edit.content, 0, edit.content.length, "list").content).toBe(
      "one\ntwo",
    );
  });
  it("adds a heading only to the current line", () => {
    expect(apply("first\nsecond", 8, 8, "heading").content).toBe(
      "first\n## second",
    );
  });
  it("formats an empty first line without touching the next line", () => {
    expect(apply("\ntext", 0, 0, "heading").content).toBe("## \ntext");
  });
  it("creates a fenced block around code", () => {
    expect(apply("const x = 1", 0, 11, "code").content).toBe(
      "```\nconst x = 1\n```",
    );
  });
  it("preserves link text and selects the destination", () => {
    const edit = apply("Read docs", 5, 9, "link");
    expect(edit.content).toBe("Read [docs](https://)");
    expect(edit.content.slice(edit.selection.anchor, edit.selection.head)).toBe(
      "https://",
    );
  });
});

describe("Markdown preview URLs", () => {
  it("blocks executable and local filesystem URLs", () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,bad",
      "//remote.example/a",
      "../private.md",
    ]) {
      expect(safePreviewUrl(url)).toBe("");
    }
  });
  it("permits explicit web links, anchors and mail links", () => {
    for (const url of [
      "https://example.com/a",
      "http://example.com",
      "#heading",
      "mailto:a@example.com",
    ]) {
      expect(safePreviewUrl(url)).toBe(url);
    }
  });
});

describe("Local preview image paths", () => {
  it("resolves images relative to the note folder", async () => {
    const { resolvePreviewAsset } = await import(
      "../src/components/PreviewImage"
    );
    expect(resolvePreviewAsset("工作/计划", "./images/hello%20world.png")).toBe(
      "工作/计划/images/hello world.png",
    );
    expect(resolvePreviewAsset("工作/计划", "../图.png?width=50#preview")).toBe(
      "工作/图.png",
    );
    expect(resolvePreviewAsset("", "assets/photo.jpg")).toBe(
      "assets/photo.jpg",
    );
    expect(resolvePreviewAsset("工作", "../root.png")).toBe("root.png");
  });
  it("rejects escaping paths and absolute or executable URLs", async () => {
    const { resolvePreviewAsset } = await import(
      "../src/components/PreviewImage"
    );
    for (const url of [
      "../../secret.png",
      "%2e%2e/%2e%2e/secret.png",
      "/etc/image.png",
      "//remote/image.png",
      "C:\\image.png",
      "..\\image.png",
      "file:///image.png",
      "data:image/png,x",
      "javascript:alert(1)",
      "%2fetc/image.png",
      "bad%00.png",
      "%ZZ.png",
    ]) {
      expect(resolvePreviewAsset("工作", url)).toBeNull();
    }
  });
  it("allows relative images through URL transformation without enabling local links", async () => {
    const { previewImageUrl } = await import("../src/components/PreviewImage");
    expect(previewImageUrl("工作", "../image.png")).toBe("../image.png");
    expect(previewImageUrl("", "../image.png")).toBe("");
    expect(previewImageUrl("", "https://example.com/image.png")).toBe(
      "https://example.com/image.png",
    );
    expect(previewImageUrl("", "file:///image.png")).toBe("");
    expect(safePreviewUrl("assets/image.png")).toBe("");
  });
});
