import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { expect, it } from "vitest";
import remarkLineBreaks from "../src/components/remarkLineBreaks";

const preview = (content: string) =>
  renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkLineBreaks],
      children: content,
    }),
  );

it("preserves ordinary line breaks, including formatted text, list continuations and quotes", () => {
  const html = preview(
    "第一行\n**第二行**\n第三行\n\n- 列表\n  续行\n\n> 引用\n> 第二行",
  );
  expect(html).toContain("第一行<br/>\n<strong>第二行</strong><br/>\n第三行");
  expect(html).toContain("<li>列表<br/>\n续行</li>");
  expect(html).toContain("<p>引用<br/>\n第二行</p>");
});

it("keeps paragraphs, explicit breaks, code, tables and lists intact", () => {
  const html = preview(
    "第一行  \n第二行\n\n新段落\n\n```ts\na()\nb()\n```\n\n`行内代码`\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n1. 第一项\n2. 第二项",
  );
  expect(html).toContain("<p>第一行<br/>\n第二行</p>");
  expect(html).toContain("<p>新段落</p>");
  expect(html).toContain(
    '<pre><code class="language-ts">a()\nb()\n</code></pre>',
  );
  expect(html).toContain("<code>行内代码</code>");
  expect(html).toContain("<table>");
  expect(html).toContain("<li>第一项</li>");
  expect(html).toContain("<li>第二项</li>");
});
