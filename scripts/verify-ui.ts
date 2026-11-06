import { _electron as electron, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
const testHome = await fs.mkdtemp("/tmp/xnote-ui-native-");
const env: Record<string, string> = Object.fromEntries(
  Object.entries({ ...process.env, XNOTE_HOME: testHome }).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.XNOTE_DEV_URL;
const executablePath = process.env.XNOTE_EXECUTABLE;
const application = await electron.launch({
  args: [
    ...(executablePath ? [] : ["."]),
    `--user-data-dir=${testHome}/electron`,
  ],
  executablePath,
  env,
});
try {
  const page = await application.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("heading", { name: "给想法一个落脚点" }),
  ).toBeVisible();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 920),
  );
  await page.evaluate(async () => {
    const api = window.xnote!;
    await api.createFolder("工作/项目");
    await api.createFolder("生活");
    const notes: [string, string, "md" | "txt", string][] = [
      [
        "把想法写清楚",
        "",
        "md",
        '用简洁的文字，保存那些值得再次回看的想法。\n\n## 给思考留一点空间\n\n好的记录，不需要复杂的形式。把**重要的事**写下来，再慢慢梳理它们之间的联系。\n\n- 整理今天的项目记录\n- 留下一句读书时的感想\n- 把临时的灵感变成清晰的线索\n\n> 少一点干扰，多一点专注。\n\n### 一个小小的开始\n\n从一段文字开始，让记录成为自然的习惯。\n\n```ts\nconst idea = "keep it simple";\n```\n',
      ],
      [
        "阅读与摘录",
        "生活",
        "md",
        "## 最近在读\n\n记下那些让人停下来想一想的句子。",
      ],
      [
        "下一次迭代",
        "工作/项目",
        "md",
        "## 设计记录\n\n让产品的每一次变化都有迹可循。",
      ],
      ["周末的安排", "生活", "txt", "去公园走走。买一束花。读一本书。"],
      [
        "会议随记",
        "工作",
        "md",
        "## 关于新的方向\n\n保持简单，先把重要的事情做好。",
      ],
    ];
    let first = "";
    for (const [title, folder, type, content] of notes) {
      let n = await api.createNote(type, folder);
      n = await api.renameNote(n.path, title, n.revision);
      n = await api.saveNote(n.path, content, n.revision);
      if (!first) first = n.path;
    }
    await api.toggleFavorite(first);
    await api.updatePreferences({
      theme: "light",
      lastNote: first,
      sidebarCollapsed: false,
    });
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveValue(
    "把想法写清楚",
  );
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .press("ArrowDown");
  await page.getByRole("textbox", { name: "正文", exact: true }).blur();
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round2-light.png",
  });
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Markdown 预览" }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round2-preview.png",
  });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "折叠侧边栏", exact: true }).click();
  await expect(page.locator(".app")).toHaveClass(/sidebar-collapsed/);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round2-compact.png",
  });
  await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "设置", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round2-settings.png",
  });
  await page.getByLabel("主题", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round2-dark.png",
  });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(860, 600),
  );
  await expect(page.locator(".editor-panel")).toBeVisible();
  expect(
    await page
      .locator(".editor-toolbar")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round2-narrow.png",
  });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1920, 1080),
  );
  const metrics = await page.locator(".document-editor").evaluate((el) => ({
    inner:
      el.clientWidth -
      parseFloat(getComputedStyle(el).paddingLeft) -
      parseFloat(getComputedStyle(el).paddingRight),
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  expect(metrics.inner).toBeLessThanOrEqual(800);
  expect(metrics.overflow).toBe(false);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round2-wide.png",
  });
  expect(errors).toEqual([]);
  console.log(
    `UI verification PASS: real Electron light/dark, preview, compact, settings, 860x600 and1920x1080; content width ${metrics.inner}px. Files ${testHome}`,
  );
} finally {
  await application.close();
}
