import { _electron as electron, expect, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
/** Audit rendered chrome, excluding document content whose semantic colors are preserved. */
async function auditNeutralUi(page: Page) {
  const invalid = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const results: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".cm-content, .markdown-preview")) continue;
      const rect = el.getBoundingClientRect(),
        style = getComputedStyle(el);
      if (!rect.width || !rect.height || style.visibility === "hidden")
        continue;
      for (const key of [
        "color",
        "backgroundColor",
        "borderTopColor",
        "outlineColor",
        "fill",
        "stroke",
      ] as const) {
        const color = style[key];
        if (color === "none" || color === "transparent") continue;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        if (a && Math.max(r, g, b) - Math.min(r, g, b) > 1)
          results.push(
            `${el.tagName}.${el.getAttribute("class") || ""} ${key}=${style[key]}`,
          );
      }
    }
    return results;
  });
  expect(invalid).toEqual([]);
  const iconErrors = await page
    .locator("svg.lucide:not(.brand-mark)")
    .evaluateAll((els) =>
      els
        .filter(
          (el) =>
            el.getBoundingClientRect().width &&
            (![12, 14, 16].includes(el.getBoundingClientRect().width) ||
              getComputedStyle(el).fill !== "none" ||
              getComputedStyle(el).strokeWidth !== "1.6px"),
        )
        .map((el) => el.outerHTML),
    );
  expect(iconErrors).toEqual([]);
}

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
  await expect(page.locator(".brand-mark")).toHaveCSS("width", "22px");
  await expect(page.locator(".brand-mark")).toHaveCSS("height", "22px");
  await expect(page.locator(".brand")).toHaveCSS("gap", "8px");
  await expect(page.locator(".brand-name")).toHaveCSS("font-size", "16px");
  const brand = await page.locator(".brand").evaluate((el) => {
    const icon = el.querySelector("svg")!.getBoundingClientRect();
    const text = el.querySelector(".brand-name")!.getBoundingClientRect();
    return Math.abs(icon.y + icon.height / 2 - text.y - text.height / 2);
  });
  expect(brand).toBeLessThan(1);
  await auditNeutralUi(page);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round4-empty.png",
  });
  await page.evaluate(async () => {
    const api = window.xnote!;
    await api.createFolder("工作/项目");
    await api.createFolder("生活");
    const notes: [string, string, "md" | "txt", string][] = [
      [
        "把想法写清楚",
        "",
        "md",
        '用简洁的文字，保存那些值得再次回看的想法。查看[参考资料](https://example.com)。\n\n## 给思考留一点空间\n\n好的记录，不需要复杂的形式。把**重要的事**写下来，再慢慢梳理它们之间的联系。\n\n- 整理今天的项目记录\n- 留下一句读书时的感想\n- 把临时的灵感变成清晰的线索\n\n> 少一点干扰，多一点专注。\n\n### 一个小小的开始\n\n从一段文字开始，让记录成为自然的习惯。\n\n```ts\nconst idea = "keep it simple";\n```\n',
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
  for (const nav of await page.locator(".main-nav button").all())
    await expect(nav).toHaveCSS("font-size", "14px");
  await expect(page.getByRole("textbox", { name: "搜索笔记" })).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(page.locator(".main-nav .selected")).toHaveCSS(
    "color",
    "rgb(41, 41, 41)",
  );
  await expect(page.locator(".main-nav .selected")).toHaveCSS(
    "background-color",
    "rgb(238, 238, 238)",
  );
  await expect(
    page.getByRole("button", { name: "编辑", exact: true }),
  ).toHaveCSS("color", "rgb(41, 41, 41)");
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveCSS("font-size", "14px");
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter(
        (el) =>
          el.getBoundingClientRect().height &&
          ![12, 14, 16].includes(parseFloat(getComputedStyle(el).fontSize)),
      )
      .map((el) => `${el.tagName}: ${getComputedStyle(el).fontSize}`),
  );
  expect(sizes).toEqual([]);
  await auditNeutralUi(page);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round4-light.png",
  });
  const recent = page
    .locator(".main-nav")
    .getByRole("button", { name: "最近编辑", exact: true });
  await recent.hover();
  await expect(recent).toHaveCSS("background-color", "rgb(245, 245, 245)");
  await page.mouse.down();
  await expect(recent).toHaveCSS("background-color", "rgb(238, 238, 238)");
  await page.mouse.up();
  await page
    .locator(".main-nav")
    .getByRole("button", { name: "全部笔记", exact: true })
    .click();
  const preview = page.getByRole("button", { name: "预览", exact: true });
  await preview.hover();
  await expect(preview).toHaveCSS("background-color", "rgb(240, 240, 240)");
  await auditNeutralUi(page);
  const compose = page
    .locator(".list-top")
    .getByRole("button", { name: "新建笔记", exact: true });
  await compose.focus();
  await expect(compose).toHaveCSS("outline-color", "rgb(153, 153, 153)");
  await compose.blur();
  await page.getByRole("textbox", { name: "搜索笔记" }).fill("想法");
  await expect(page.locator("mark").first()).toBeVisible();
  await auditNeutralUi(page);
  await page.getByRole("textbox", { name: "搜索笔记" }).fill("");
  await page
    .locator(".list-top")
    .getByRole("button", { name: "新建笔记", exact: true })
    .click();
  await expect(page.getByRole("menu", { name: "新建笔记类型" })).toBeVisible();
  await auditNeutralUi(page);
  await page.keyboard.press("Escape");
  await page.locator(".note-item.active").click({ button: "right" });
  await expect(page.locator(".context-menu")).toBeVisible();
  await auditNeutralUi(page);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round4-context.png",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "笔记操作", exact: true }).click();
  await auditNeutralUi(page);
  await page.getByRole("menuitem", { name: "删除笔记", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "删除笔记", exact: true }),
  ).toBeVisible();
  await auditNeutralUi(page);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round4-dialog.png",
  });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Markdown 预览" }),
  ).toBeVisible();
  await expect(page.locator(".markdown-preview")).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(page.locator(".markdown-preview a")).toHaveCSS(
    "color",
    "rgb(183, 123, 79)",
  );
  await auditNeutralUi(page);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round4-preview.png",
  });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "折叠侧边栏", exact: true }).click();
  await expect(page.locator(".app")).toHaveClass(/sidebar-collapsed/);
  await auditNeutralUi(page);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round4-compact.png",
  });
  await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "设置", exact: true }),
  ).toBeVisible();
  await auditNeutralUi(page);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round4-settings.png",
  });
  await expect(page.getByLabel("主题", { exact: true })).toHaveCSS(
    "font-size",
    "14px",
  );
  await page.getByRole("button", { name: "文件存储", exact: true }).click();
  await auditNeutralUi(page);
  await page.getByRole("button", { name: "快捷键", exact: true }).click();
  await auditNeutralUi(page);
  await page.getByRole("button", { name: "通用", exact: true }).click();
  await page.getByLabel("主题", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await auditNeutralUi(page);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round4-dark.png",
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
  await auditNeutralUi(page);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round4-narrow.png",
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
  await auditNeutralUi(page);
  await page.screenshot({
    animations: "disabled",
    path: "docs/ui-round4-wide.png",
  });
  expect(errors).toEqual([]);
  console.log(
    `Round 4 neutral UI verification PASS: real Electron light/dark, preview, compact, settings, 860x600 and1920x1080; content width ${metrics.inner}px. Files ${testHome}`,
  );
} finally {
  await application.close();
}
