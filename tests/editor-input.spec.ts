import { test, expect, type Page } from "@playwright/test";
import type { Note } from "../src/types";
let currentNote: Note;
const body = (p: Page) => p.getByRole("textbox", { name: "正文", exact: true });
const btn = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
async function select(p: Page, start: number, length: number) {
  await body(p).focus();
  await body(p).press("ControlOrMeta+Home");
  await body(p).press("ControlOrMeta+ArrowUp");
  for (let i = 0; i < start; i++) await p.keyboard.press("ArrowRight");
  for (let i = 0; i < length; i++) await p.keyboard.press("Shift+ArrowRight");
}
test.beforeEach(async ({ page, request }) => {
  const call = async (method: string, ...args: unknown[]) => {
    const r = await request.post(`/api/${method}`, { data: { args } });
    expect(r.ok()).toBeTruthy();
    return (await r.json()).data;
  };
  await call("updatePreferences", {
    theme: "light",
    fontSize: 16,
    sidebarCollapsed: false,
    sidebarWidth: 220,
    listWidth: 300,
  });
  const n: Note = await call("createNote", "md");
  currentNote = n;
  await call("updatePreferences", { lastNote: n.path });
  await page.goto("/");
  await expect(body(page)).toBeVisible();
});
test("italic works within English words, toggles off, and formats subsequent Chinese typing", async ({
  page,
}) => {
  await body(page).fill("hello 中文");
  await select(page, 1, 3);
  await btn(page, "斜体").click();
  await expect(body(page)).toHaveText("h*ell*o 中文");
  await expect(btn(page, "斜体")).toHaveAttribute("aria-pressed", "true");
  await expect(body(page)).toBeFocused();
  await btn(page, "斜体").click();
  await expect(body(page)).toHaveText("hello 中文");
  await body(page).fill("");
  await btn(page, "斜体").click();
  await page.keyboard.insertText("中文 English 123!，");
  await expect(body(page)).toHaveText("*中文 English 123!，*");
  await btn(page, "预览").click();
  await expect(page.locator(".markdown-preview em")).toHaveText(
    "中文 English 123!，",
  );
  await expect(page.locator(".markdown-preview em")).toHaveCSS(
    "font-style",
    "italic",
  );
  await expect(page.locator(".markdown-preview")).toHaveCSS(
    "font-synthesis",
    "style",
  );
  await btn(page, "斜体").click();
  await expect(body(page)).toBeFocused();
  await expect(body(page)).toHaveText("中文 English 123!，");
});
test("native caret, single Enter, soft breaks, focus restoration and browser IME composition", async ({
  page,
  request,
}) => {
  await body(page).fill("第一段 abc123!，");
  await body(page).press("ArrowRight");
  await expect(body(page)).toHaveCSS("caret-color", "rgb(74, 74, 74)");
  await expect(page.locator(".cm-cursorLayer")).toHaveCount(0);
  const before = await body(page).boundingBox();
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("第二段");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText("软换行");
  await expect
    .poll(async () => {
      const response = await request.post("/api/readNote", {
        data: { args: [currentNote.path] },
      });
      return (await response.json()).data.content;
    })
    .toBe("第一段 abc123!，\n第二段  \n软换行");
  expect((await body(page).boundingBox())!.y).toBe(before!.y);
  await page.getByRole("textbox", { name: "笔记标题" }).focus();
  await body(page).focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "中文输入",
    selectionStart: 4,
    selectionEnd: 4,
  });
  await cdp.send("Input.insertText", { text: "中文输入" });
  await expect(body(page)).toContainText("软换行中文输入");
  await btn(page, "预览").click();
  await expect(page.locator(".markdown-preview > p")).toHaveCount(1);
  await expect(page.locator(".markdown-preview br")).toHaveCount(2);
});
test("selection survives keyboard toolbar focus, bold undo and pointer insertion", async ({
  page,
}) => {
  await body(page).fill("alpha beta");
  await select(page, 0, 5);
  await btn(page, "粗体").focus();
  await page.keyboard.press("Enter");
  await expect(body(page)).toHaveText("**alpha** beta");
  await expect(btn(page, "粗体")).toHaveAttribute("aria-pressed", "true");
  await body(page).press("ControlOrMeta+z");
  await expect(body(page)).toHaveText("alpha beta");
  const point = await page
    .locator(".cm-line")
    .first()
    .evaluate((line) => {
      const text = document
        .createTreeWalker(line, NodeFilter.SHOW_TEXT)
        .nextNode()!;
      const r = document.createRange();
      r.setStart(text, 5);
      r.setEnd(text, 5);
      const b = r.getBoundingClientRect();
      return { x: b.x, y: b.y + b.height / 2 };
    });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.insertText("中1!");
  await expect(body(page)).toHaveText("alpha中1! beta");
  await select(page, 0, 5);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("alpha");
});
test("heading, quote, list, code and link match their preview rendering", async ({
  page,
}) => {
  for (const [name, text, selector] of [
    ["二级标题", "标题", "h2"],
    ["引用", "引用内容", "blockquote"],
    ["无序列表", "事项", "li"],
    ["代码块", "const x = 1", "pre code"],
  ]) {
    await body(page).fill(text);
    await select(page, 0, text.length);
    await btn(page, name).click();
    await btn(page, "预览").click();
    await expect(page.locator(`.markdown-preview ${selector}`)).toContainText(
      text,
    );
    await btn(page, "编辑").click();
  }
  await body(page).fill("链接");
  await select(page, 0, 2);
  await btn(page, "插入链接").click();
  await page.keyboard.insertText("https://example.com");
  await btn(page, "预览").click();
  await expect(page.locator(".markdown-preview a")).toHaveAttribute(
    "href",
    "https://example.com",
  );
});
test("type/icon tokens, centered responsive content and stable source marker geometry", async ({
  page,
}) => {
  await body(page).fill(
    "## 标题\n\n一段带有 **强调文字** 和 *斜体文字* 的长段落。".repeat(4),
  );
  for (const width of [640, 860, 1280, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const m = await page.locator(".document-editor").evaluate((el) => {
      const s = getComputedStyle(el),
        p = el.closest(".editor-panel")!.getBoundingClientRect(),
        r = el.getBoundingClientRect();
      return {
        inner:
          el.clientWidth -
          parseFloat(s.paddingLeft) -
          parseFloat(s.paddingRight),
        center: Math.abs(r.x + r.width / 2 - p.x - p.width / 2),
      };
    });
    expect(m.inner).toBeLessThanOrEqual(800);
    expect(m.center).toBeLessThan(1);
    const invalid = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter(
          (el) =>
            el.getBoundingClientRect().height &&
            !el.closest(".brand") &&
            ![12, 14, 16].includes(parseFloat(getComputedStyle(el).fontSize)),
        )
        .map((el) => `${el.tagName}: ${getComputedStyle(el).fontSize}`),
    );
    expect(invalid).toEqual([]);
    expect(
      await page
        .locator("svg.lucide:not(.brand-mark)")
        .evaluateAll((els) =>
          els
            .filter(
              (el) =>
                el.getBoundingClientRect().width &&
                ![12, 14, 16].includes(el.getBoundingClientRect().width),
            )
            .map((el) => el.outerHTML),
        ),
    ).toEqual([]);
    expect(
      await page
        .locator(".editor-toolbar")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1000, height: 800 });
  await body(page).fill(
    "**带有格式的长段落保持稳定的文字位置。**".repeat(7) + "\n\n末尾",
  );
  const line = page.locator(".cm-line").first(),
    before = await line.boundingBox();
  await line.click();
  expect((await line.boundingBox())!.height).toBe(before!.height);
  await btn(page, "预览").click();
  expect(
    await page
      .locator(".markdown-preview *")
      .evaluateAll((els) =>
        els
          .filter(
            (el) =>
              ![12, 14, 16].includes(parseFloat(getComputedStyle(el).fontSize)),
          )
          .map((el) => el.tagName),
      ),
  ).toEqual([]);
});

test("TXT keeps ordinary newlines; Markdown lists and code keep their native Enter behavior", async ({
  page,
  request,
}) => {
  await body(page).fill("- one");
  await body(page).press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("two");
  await btn(page, "预览").click();
  await expect(page.locator(".markdown-preview li")).toHaveText(["one", "two"]);
  await btn(page, "编辑").click();
  await body(page).fill("```js\nconst a = 1\n```");
  await select(page, 17, 0);
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("const b = 2");
  await expect
    .poll(async () => {
      const r = await request.post("/api/readNote", {
        data: { args: [currentNote.path] },
      });
      return (await r.json()).data.content;
    })
    .toBe("```js\nconst a = 1\nconst b = 2\n```");
  const noteResponse = await request.post("/api/createNote", {
    data: { args: ["txt"] },
  });
  const txt: Note = (await noteResponse.json()).data;
  await request.post("/api/updatePreferences", {
    data: { args: [{ lastNote: txt.path }] },
  });
  await page.reload();
  await expect(body(page)).toBeVisible();
  await body(page).fill("纯文本");
  await body(page).press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("第二行");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText("第三行");
  await expect
    .poll(async () => {
      const r = await request.post("/api/readNote", {
        data: { args: [txt.path] },
      });
      return (await r.json()).data.content;
    })
    .toBe("纯文本\n第二行\n第三行");
  await expect(page.locator(".editor-toolbar")).toHaveCount(0);
});
