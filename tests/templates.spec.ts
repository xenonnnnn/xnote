import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Note, Snapshot } from "../src/types";

async function call<T>(
  request: APIRequestContext,
  method: string,
  ...args: unknown[]
): Promise<T> {
  const response = await request.post(`/api/${method}`, { data: { args } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).data as T;
}

async function openTemplates(page: Page) {
  await page.getByRole("button", { name: "模板", exact: true }).click();
  await expect(page.locator(".template-center")).toBeVisible();
}

const body = (page: Page) =>
  page.getByRole("textbox", { name: "正文", exact: true });
const title = (page: Page) =>
  page.getByRole("textbox", { name: "笔记标题", exact: true });
const useTemplate = (page: Page, name: string) =>
  page
    .locator(".template-item")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: /使用/ });

// Keep fixtures separate even when another spec has switched the local storage root.
let initial: Snapshot;
let fixtureFolder: string;
test.beforeEach(async ({ request, page }) => {
  initial = await call<Snapshot>(request, "snapshot");
  fixtureFolder = `模板验收-${Date.now().toString(36)}`;
  await call(request, "createFolder", fixtureFolder);
  await call(request, "updatePreferences", {
    theme: "light",
    sidebarCollapsed: false,
    sidebarWidth: 220,
    listWidth: 300,
    restoreLastNote: false,
    lastNote: null,
  });
  await page.goto("/");
  await expect(page.locator(".note-list-panel")).toBeVisible();
});

test.afterEach(async ({ request, page }) => {
  await page.close();
  const current = await call<Snapshot>(request, "snapshot");
  for (const note of current.notes) {
    if (!initial.notes.some((old) => old.path === note.path)) {
      await call(request, "deleteNote", note.path, note.revision);
    }
  }
  await fs.rm(path.join(initial.config.root, fixtureFolder, "pixel.png"), {
    force: true,
  });
  await call(request, "deleteFolder", fixtureFolder);
  await call(request, "updatePreferences", initial.config.preferences);
});

test("template navigation preserves three columns and displays all four templates", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: "模板", exact: true }),
  ).toBeVisible({ timeout: 2000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTemplates(page);
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".note-list-panel")).toBeVisible();
  await expect(
    page
      .locator(".template-center")
      .getByRole("heading", { name: "模板", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("选择一个模板，快速创建笔记。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".template-item")).toHaveCount(4);
  for (const name of ["Q&A 笔记", "学习笔记", "代码笔记", "空白笔记"]) {
    await expect(useTemplate(page, name)).toBeVisible();
  }
  const navigation = page.getByRole("button", { name: "模板", exact: true });
  await expect(navigation.locator("span")).toHaveCSS("font-size", "14px");
  await expect(navigation.locator("svg")).toHaveAttribute("width", "16");
  await page.screenshot({ path: "docs/template-center-light.png" });
  await page.setViewportSize({ width: 1000, height: 680 });
  for (const name of ["Q&A 笔记", "学习笔记", "代码笔记", "空白笔记"]) {
    await expect(useTemplate(page, name)).toBeVisible();
  }
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  expect((await page.locator(".app").boundingBox())!.height).toBe(680);
  await page.screenshot({
    path: "docs/template-center-narrow.png",
    animations: "disabled",
  });
});

const qaContent = `# 新建问答

## 问题

在这里记录你不理解的问题。

## 原始内容

可以粘贴代码、报错信息、文档片段或其他相关内容。

## 答案

在这里记录查询后得到的答案。

## 详细解释

在这里补充原理、实现过程和关键知识点。

## 补充记录

记录自己的理解、后续疑问或相关参考资料。
`;
const templateCases = [
  { name: "Q&A 笔记", title: "新建问答", badge: "Q&A", content: qaContent },
  {
    name: "学习笔记",
    title: "学习主题",
    badge: "MD",
    content:
      "# 学习主题\n\n## 学习目标\n\n## 核心知识点\n\n## 详细记录\n\n## 学习总结\n\n## 待解决的问题\n",
  },
  {
    name: "代码笔记",
    title: "代码主题",
    badge: "MD",
    content:
      "# 代码主题\n\n## 使用场景\n\n## 代码内容\n\n## 实现思路\n\n## 关键知识点\n\n## 注意事项\n",
  },
  { name: "空白笔记", title: "Untitled", badge: "MD", content: "" },
];

async function createFromTemplate(page: Page, name: string): Promise<Note> {
  await openTemplates(page);
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/createNote"),
  );
  await useTemplate(page, name).click();
  const created = await response;
  expect(created.ok(), await created.text()).toBeTruthy();
  const note: Note = (await created.json()).data;
  await expect(page.locator(".template-center")).not.toBeVisible();
  await expect(title(page)).toHaveValue(note.title);
  await expect(body(page)).toBeVisible();
  return note;
}

// Real filesystem assertions distinguish a complete template write from a pending editor draft.
test("all templates create exact Markdown files without mixing contents or overwriting names", async ({
  page,
  request,
}) => {
  const created: Note[] = [];
  for (const template of templateCases) {
    const note = await createFromTemplate(page, template.name);
    created.push(note);
    expect(note.path).toMatch(/\.md$/);
    expect(note.content).toBe(template.content);
    expect(note.title).toMatch(new RegExp(`^${template.title}(?: \\d+)?$`));
    expect(
      await fs.readFile(path.join(initial.config.root, note.path), "utf8"),
    ).toBe(template.content);
    await expect(page.locator(".note-item.active .type-badge")).toHaveText(
      template.badge,
    );
  }
  const repeated = await createFromTemplate(page, "Q&A 笔记");
  expect(repeated.path).not.toBe(created[0].path);
  expect(repeated.content).toBe(qaContent);
  expect(
    await fs.readFile(path.join(initial.config.root, created[0].path), "utf8"),
  ).toBe(qaContent);
  const normal = await call<Note>(request, "createNote", "md", fixtureFolder);
  await call(request, "saveNote", normal.path, qaContent, normal.revision);
  const txt = await call<Note>(request, "createNote", "txt", fixtureFolder);
  await call(request, "saveNote", txt.path, "普通纯文本内容", txt.revision);
  await page.reload();
  await expect(
    page
      .locator(".note-item")
      .filter({
        has: page.getByRole("button", {
          name: `打开笔记 ${normal.title}`,
          exact: true,
        }),
      })
      .filter({ hasText: fixtureFolder })
      .filter({ hasText: "在这里记录你不理解的问题" })
      .locator(".type-badge"),
  ).toHaveText("MD");
  await expect(
    page
      .locator(".note-item")
      .filter({ hasText: "普通纯文本内容" })
      .locator(".type-badge"),
  ).toHaveText("TXT");
  await expect(
    page
      .locator(".note-item")
      .filter({ hasText: created[0].title })
      .filter({ has: page.locator(".type-badge", { hasText: "Q&A" }) })
      .first(),
  ).toBeVisible();
});

test("Q&A uses the existing Markdown editor and survives rich editing, rename, search, favorites and reopen", async ({
  page,
  request,
}) => {
  const note = await createFromTemplate(page, "Q&A 笔记");
  const noteTitle = `闭包问题-${Date.now().toString(36)}`;
  const imagePath = path.join(initial.config.root, fixtureFolder, "pixel.png");
  await fs.writeFile(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const rich = `# 闭包是什么\n\n## 问题\n\n为什么**内部函数**可以读取*外部变量*？\n\n## 原始内容\n\n\`\`\`javascript\nfunction outer() {\n  const value = 1;\n  return () => value;\n}\n\`\`\`\n\n## 答案\n\n- 保留词法作用域\n- 使用 \`value\`\n\n1. 创建函数\n2. 调用函数\n\n> 保存外部环境。\n\n### 更多细节\n\n| 术语 | 说明 |\n| --- | --- |\n| 闭包 | 函数及环境 |\n\n[参考链接](https://example.com)\n\n![参考图](${fixtureFolder}/pixel.png)\n\n---\n\n## 详细解释\n\n完整 Markdown 能力验收。\n\n## 补充记录\n\n后续继续探索。\n`;
  await title(page).fill(noteTitle);
  await title(page).press("Enter");
  await body(page).fill(rich);
  const renamedPath = `${noteTitle}.md`;
  await expect
    .poll(() =>
      fs
        .readFile(path.join(initial.config.root, renamedPath), "utf8")
        .catch(() => ""),
    )
    .toBe(rich);
  await expect(page.locator(".note-item.active .type-badge")).toHaveText("Q&A");
  await expect(page.locator(".note-item.active .type-badge")).toHaveCSS(
    "font-size",
    "12px",
  );
  await page.getByRole("button", { name: "预览", exact: true }).click();
  const preview = page.locator(".markdown-preview");
  await expect(
    preview.getByRole("heading", { name: "闭包是什么", exact: true }),
  ).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("内部函数");
  await expect(preview.locator("em")).toHaveText("外部变量");
  await expect(preview.locator("pre code")).toContainText("function outer()");
  await expect(preview.locator("ul li")).toHaveCount(2);
  await expect(preview.locator("ol li")).toHaveCount(2);
  await expect(preview.locator("blockquote")).toContainText("保存外部环境");
  await expect(preview.getByRole("table")).toBeVisible();
  await expect(preview.locator("hr")).toHaveCount(1);
  await expect(preview.getByRole("link", { name: "参考链接" })).toHaveAttribute(
    "href",
    "https://example.com",
  );
  await expect(preview.getByRole("img", { name: "参考图" })).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  await page.getByRole("button", { name: "收藏笔记", exact: true }).click();
  await page.getByRole("button", { name: "收藏夹", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `打开笔记 ${noteTitle}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "最近编辑", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `打开笔记 ${noteTitle}`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "搜索笔记", exact: true })
    .fill("词法作用域");
  await expect(page.locator(".note-item")).toHaveCount(1);
  await expect(page.locator(".note-item .type-badge")).toHaveText("Q&A");
  await call(request, "updatePreferences", { restoreLastNote: true });
  await page.reload();
  await expect(title(page)).toHaveValue(noteTitle);
  expect((await call<Note>(request, "readNote", renamedPath)).content).toBe(
    rich,
  );
  await openTemplates(page);
  await page
    .getByRole("button", { name: `打开笔记 ${noteTitle}`, exact: true })
    .click();
  await expect(page.locator(".template-center")).not.toBeVisible();
  await expect(title(page)).toHaveValue(noteTitle);
  expect(
    await fs.readFile(path.join(initial.config.root, renamedPath), "utf8"),
  ).toBe(rich);
  expect(
    (await call<Snapshot>(request, "snapshot")).notes.find(
      (n) => n.path === renamedPath,
    )?.noteType,
  ).toBe("qa");
  expect(note.path).not.toBe(renamedPath);
});

test("failed creation keeps the template center usable and does not leave a new file", async ({
  page,
  request,
}) => {
  await openTemplates(page);
  const before = await call<Snapshot>(request, "snapshot");
  await page.route(
    "**/api/createNote",
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "测试目录不可写，请检查权限。" }),
      }),
    { times: 1 },
  );
  await useTemplate(page, "Q&A 笔记").click();
  await expect(page.getByRole("alert")).toContainText("测试目录不可写");
  await expect(page.locator(".template-center")).toBeVisible();
  await expect(useTemplate(page, "Q&A 笔记")).toBeEnabled();
  expect(
    (await call<Snapshot>(request, "snapshot")).notes.map((n) => n.path).sort(),
  ).toEqual(before.notes.map((n) => n.path).sort());
  await useTemplate(page, "学习笔记").click();
  await expect(title(page)).toHaveValue(/^学习主题(?: \d+)?$/);
});

test("rapid template clicks create only one note and ordinary creation exits the center", async ({
  page,
  request,
}) => {
  await openTemplates(page);
  const before = await call<Snapshot>(request, "snapshot");
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  let requests = 0;
  await page.route("**/api/createNote", async (route) => {
    requests++;
    started();
    await gate;
    await route.continue();
  });
  await useTemplate(page, "Q&A 笔记").evaluate((element: HTMLButtonElement) => {
    element.click();
    element.click();
  });
  await pending;
  await expect(useTemplate(page, "学习笔记")).toBeDisabled();
  release();
  await expect(title(page)).toHaveValue(/^新建问答(?: \d+)?$/);
  await expect(page.locator(".template-center")).not.toBeVisible();
  await expect(body(page)).toBeVisible();
  expect(requests).toBe(1);
  expect((await call<Snapshot>(request, "snapshot")).notes.length).toBe(
    before.notes.length + 1,
  );
  await page.unroute("**/api/createNote");
  await openTemplates(page);
  await page
    .locator(".list-top")
    .getByRole("button", { name: "新建笔记", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "纯文本" }).click();
  await expect(page.locator(".template-center")).not.toBeVisible();
  await expect(body(page)).toBeVisible();
  const blankTXT = (await call<Snapshot>(request, "snapshot")).notes.find(
    (note) =>
      note.type === "txt" &&
      !before.notes.some((old) => old.path === note.path),
  );
  expect(blankTXT?.content).toBe("");
  expect(
    await fs.readFile(path.join(initial.config.root, blankTXT!.path), "utf8"),
  ).toBe("");
  await expect(page.locator(".note-item.active .type-badge")).toHaveText("TXT");
  await body(page).fill("TXT 创建仍可正常编辑保存。");
  await expect
    .poll(async () =>
      (await call<Snapshot>(request, "snapshot")).notes.some(
        (n) => n.type === "txt" && n.content === "TXT 创建仍可正常编辑保存。",
      ),
    )
    .toBe(true);
});

test("context opening a listed note leaves the template center", async ({
  page,
}) => {
  const note = await createFromTemplate(page, "Q&A 笔记");
  await openTemplates(page);
  await page
    .getByRole("button", { name: `打开笔记 ${note.title}`, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "打开笔记", exact: true }).click();
  await expect(page.locator(".template-center")).not.toBeVisible();
  await expect(body(page)).toBeVisible();
  await expect(title(page)).toHaveValue(note.title);
});

test("successful creation remains editable when the following index refresh fails", async ({
  page,
  request,
}) => {
  await openTemplates(page);
  const before = await call<Snapshot>(request, "snapshot");
  await page.route(
    "**/api/createNote",
    async (route) => {
      await page.route(
        "**/api/snapshot",
        (snapshotRoute) =>
          snapshotRoute.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "测试索引暂时不可用" }),
          }),
        { times: 1 },
      );
      await route.continue();
    },
    { times: 1 },
  );
  await useTemplate(page, "Q&A 笔记").click();
  await expect(page.locator(".template-center")).not.toBeVisible();
  await expect(body(page)).toBeVisible();
  const created = (await call<Snapshot>(request, "snapshot")).notes.filter(
    (note) => !before.notes.some((old) => old.path === note.path),
  );
  expect(created).toHaveLength(1);
  await body(page).fill("创建成功之后仍能编辑和保存。");
  await expect
    .poll(() =>
      fs.readFile(path.join(initial.config.root, created[0].path), "utf8"),
    )
    .toBe("创建成功之后仍能编辑和保存。");
});

test("returning from templates preserves editing undo and Q&A copies keep their classification", async ({
  page,
  request,
}) => {
  const note = await createFromTemplate(page, "Q&A 笔记");
  await body(page).fill("基准内容");
  await expect
    .poll(() => fs.readFile(path.join(initial.config.root, note.path), "utf8"))
    .toBe("基准内容");
  await body(page).press("ControlOrMeta+ArrowRight");
  await page.keyboard.insertText("新增");
  await expect(body(page)).toHaveText("基准内容新增");
  await openTemplates(page);
  expect((await call<Note>(request, "readNote", note.path)).content).toBe(
    "基准内容新增",
  );
  await page
    .getByRole("button", { name: `打开笔记 ${note.title}`, exact: true })
    .click();
  await expect(page.locator(".template-center")).not.toBeVisible();
  await body(page).press("ControlOrMeta+z");
  await expect(body(page)).toHaveText("基准内容");
  await page.getByRole("button", { name: "笔记操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "另存为副本", exact: true }).click();
  await expect(title(page)).toHaveValue(`${note.title} (副本)`);
  await expect(page.locator(".note-item.active .type-badge")).toHaveText("Q&A");
  const copied = (await call<Snapshot>(request, "snapshot")).notes.find(
    (n) => n.title === `${note.title} (副本)`,
  );
  expect(copied?.noteType).toBe("qa");
  expect(
    await fs.readFile(path.join(initial.config.root, copied!.path), "utf8"),
  ).toBe("基准内容");
  expect((await call<Note>(request, "readNote", note.path)).content).toBe(
    "基准内容新增",
  );
});
