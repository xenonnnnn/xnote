import { _electron as electron, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NOTE_TEMPLATES } from "../src/lib/noteTemplates";

const testHome = await fs.mkdtemp("/tmp/xnote-templates-desktop-");
const environment: Record<string, string> = Object.fromEntries(
  Object.entries({ ...process.env, XNOTE_HOME: testHome }).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  ),
);
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.XNOTE_DEV_URL;
const executablePath = process.env.XNOTE_EXECUTABLE;
const application = await electron.launch({
  args: [
    ...(executablePath ? [] : ["."]),
    `--user-data-dir=${testHome}/electron`,
  ],
  executablePath,
  env: environment,
});

try {
  const page = await application.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("heading", { name: "给想法一个落脚点" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => typeof window.xnote?.createNote))
    .toBe("function");
  const title = page.getByRole("textbox", { name: "笔记标题", exact: true });
  const body = page.getByRole("textbox", { name: "正文", exact: true });
  for (const template of NOTE_TEMPLATES) {
    await page.getByRole("button", { name: "模板", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "模板", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".template-center")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.locator(".note-list-panel")).toBeVisible();
    if (template.templateId === "qa") {
      await expect(page.locator(".template-item")).toHaveCount(4);
      await page.screenshot({
        path: "docs/template-center-desktop.png",
        animations: "disabled",
      });
    }
    await page
      .getByRole("button", { name: `使用 ${template.name}模板`, exact: true })
      .click();
    await expect(title).toHaveValue(template.defaultTitle);
    await expect(body).toBeVisible();
    const filePath = `${template.defaultTitle}.${template.fileExtension}`;
    expect(
      await fs.readFile(path.join(testHome, "notes", filePath), "utf8"),
    ).toBe(template.initialContent);
    const note = await page.evaluate(
      (file) => window.xnote!.readNote(file),
      filePath,
    );
    expect(note.noteType).toBe(template.noteType);
    expect(note.content).toBe(template.initialContent);
    await expect(page.locator(".note-item.active .type-badge")).toHaveText(
      template.noteType === "qa" ? "Q&A" : "MD",
    );
  }

  await page
    .getByRole("button", { name: "打开笔记 新建问答", exact: true })
    .click();
  const renamedTitle = "JavaScript 闭包是什么";
  const renamedPath = `${renamedTitle}.md`;
  const rich = `# JavaScript 闭包是什么

## 问题

为什么**内部函数**可以读取*外部变量*？

## 原始内容

\`\`\`javascript
function outer() {
  const value = 42;
  return () => value;
}
\`\`\`

## 答案

- 函数保留词法作用域。
- 使用 \`value\` 返回结果。

> 闭包保存函数和环境。

| 术语 | 说明 |
| --- | --- |
| 闭包 | 函数及其环境 |

## 详细解释

1. 创建内部函数。
2. 调用并读取变量。

---

## 补充记录

[参考资料](https://example.com)
`;
  await title.fill(renamedTitle);
  await title.press("Enter");
  await body.fill(rich);
  await expect
    .poll(() =>
      fs
        .readFile(path.join(testHome, "notes", renamedPath), "utf8")
        .catch(() => ""),
    )
    .toBe(rich);
  await expect(page.getByText("所有更改已保存", { exact: true })).toBeVisible();
  await expect(page.locator(".note-item.active .type-badge")).toHaveText("Q&A");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  const preview = page.locator(".markdown-preview");
  await expect(
    preview.getByRole("heading", { name: renamedTitle, exact: true }),
  ).toBeVisible();
  await expect(preview.getByRole("table")).toBeVisible();
  await expect(preview.locator("pre code")).toContainText("function outer()");
  await expect(preview.locator("strong")).toHaveText("内部函数");
  await expect(preview.locator("em")).toHaveText("外部变量");
  await page
    .locator(".editor-body")
    .evaluate((element) => element.scrollTo(0, 0));
  await preview
    .getByRole("heading", { name: renamedTitle, exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/template-qa-desktop.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "收藏笔记", exact: true }).click();
  await page.reload();
  await expect(title).toHaveValue(renamedTitle);
  await expect(page.locator(".note-item.active .type-badge")).toHaveText("Q&A");
  const reopened = await page.evaluate(
    (file) => window.xnote!.readNote(file),
    renamedPath,
  );
  expect(reopened.content).toBe(rich);
  expect(reopened.noteType).toBe("qa");
  const snap = await page.evaluate(() => window.xnote!.snapshot());
  expect(snap.config.favorites).toContain(renamedPath);
  expect(snap.notes).toHaveLength(4);

  await page
    .locator(".sidebar")
    .getByRole("button", { name: "新建笔记", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "纯文本" }).click();
  await expect(page.locator(".note-item.active .type-badge")).toHaveText("TXT");
  await body.fill("TXT 文件创建和保存仍然正常。");
  await expect
    .poll(() =>
      fs
        .readFile(path.join(testHome, "notes", "Untitled.txt"), "utf8")
        .catch(() => ""),
    )
    .toBe("TXT 文件创建和保存仍然正常。");
  expect(errors).toEqual([]);
  console.log(
    `Electron template smoke PASS: four template files, IPC, rich Markdown, rename, reload, classification, favorites and TXT. Test directory: ${testHome}`,
  );
} finally {
  await application.close();
}
