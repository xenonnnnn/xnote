import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Note, Snapshot } from "../src/types";

// All fixtures are real files created through the same loopback API as the app.
const folder = `界面验收-${Date.now().toString(36)}`;
const child = `${folder}/项目`;
const title = "安静地写作";
const content =
  "# 写作空间\n\n把注意力留给**值得记录的事**。\n\n> 文字比界面更重要。\n\n- 一件小事\n- 一个想法\n\n```ts\nconst quiet = true;\n```\n";
let fixture: Note;

async function call<T>(
  request: APIRequestContext,
  method: string,
  ...args: unknown[]
): Promise<T> {
  const response = await request.post(`/api/${method}`, { data: { args } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).data as T;
}

async function expandSidebar(page: Page) {
  const expand = page.getByRole("button", { name: "展开侧边栏", exact: true });
  if (await expand.isVisible()) await expand.click();
  await expect(page.locator(".app")).not.toHaveClass(/sidebar-collapsed/);
}

async function selectFixture(page: Page) {
  await expandSidebar(page);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "全部笔记", exact: true })
    .click();
  await page
    .locator(".note-item")
    .filter({ hasText: title })
    .locator(".note-select")
    .click();
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveValue(
    title,
  );
}

async function expectWithinViewport(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.beforeAll(async ({ request }) => {
  await call(request, "createFolder", child);
  let note = await call<Note>(request, "createNote", "md", child);
  note = await call<Note>(
    request,
    "renameNote",
    note.path,
    title,
    note.revision,
  );
  fixture = await call<Note>(
    request,
    "saveNote",
    note.path,
    content,
    note.revision,
  );
});

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.locator(".note-item").filter({ hasText: title }),
  ).toBeVisible();
  await expandSidebar(page);
});

test("folder disclosure hides descendants while keeping folder selection and footer navigation", async ({
  page,
}) => {
  const nav = page.getByRole("navigation", { name: "文件夹", exact: true });
  await expect(
    nav.getByRole("button", { name: child, exact: true }),
  ).toBeVisible();
  const close = page.getByRole("button", {
    name: `收起文件夹 ${folder}`,
    exact: true,
  });
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await close.click();
  await expect(
    nav.getByRole("button", { name: child, exact: true }),
  ).not.toBeVisible();
  await nav.getByRole("button", { name: folder, exact: true }).click();
  await expect(
    page.locator(".note-item").filter({ hasText: title }),
  ).toBeVisible();
  const open = page.getByRole("button", {
    name: `展开文件夹 ${folder}`,
    exact: true,
  });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.press("Enter");
  await expect(
    nav.getByRole("button", { name: child, exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 600 });
  await expectWithinViewport(page, ".sidebar-bottom");
});

test("compact sidebar keeps category, folders, new note and settings controls usable", async ({
  page,
}) => {
  await page.getByRole("button", { name: "折叠侧边栏", exact: true }).click();
  await expect(page.locator(".app")).toHaveClass(/sidebar-collapsed/);
  const rail = page.locator(".sidebar");
  await expect(
    rail.getByRole("button", { name: "新建笔记", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(".list-top").getByRole("button", { name: "新建笔记", exact: true }),
  ).toBeVisible();
  await rail.getByRole("button", { name: "收藏夹", exact: true }).click();
  await expect(page.locator(".list-heading h1")).toHaveText("收藏夹");
  await rail.getByRole("button", { name: "最近编辑", exact: true }).click();
  await expect(page.locator(".list-heading h1")).toHaveText("最近编辑");
  await rail.getByRole("button", { name: "全部笔记", exact: true }).click();
  await expect(page.locator(".list-heading h1")).toHaveText("全部笔记");
  await expect(
    rail.getByRole("button", { name: "浏览文件夹", exact: true }),
  ).toBeVisible();
  await rail.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "设置", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.reload();
  await expect(page.locator(".app")).toHaveClass(/sidebar-collapsed/);
  await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
  await expect(page.locator(".app")).not.toHaveClass(/sidebar-collapsed/);
});

test("row actions work with keyboard focus without nesting action buttons", async ({
  page,
}) => {
  await selectFixture(page);
  const compose = page
    .locator(".list-top")
    .getByRole("button", { name: "新建笔记", exact: true });
  const anchor = await compose.boundingBox();
  await compose.click();
  const creationMenu = page.getByRole("menu", { name: "新建笔记类型" });
  await expect(creationMenu).toBeVisible();
  expect(
    Math.abs(
      (await creationMenu.boundingBox())!.y - (anchor!.y + anchor!.height + 6),
    ),
  ).toBeLessThan(2);
  await page.keyboard.press("Escape");
  await expect(compose).toBeFocused();
  const topMenu = page.getByRole("button", { name: "笔记操作", exact: true });
  await topMenu.click();
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toBeFocused();
  await topMenu.click();
  const body = page.getByRole("textbox", { name: "正文", exact: true });
  await body.click();
  await expect(body).toBeFocused();
  await topMenu.click();
  await page.keyboard.press("Escape");
  await expect(topMenu).toBeFocused();
  const row = page.locator(".note-item").filter({ hasText: title });
  const more = row.getByRole("button", {
    name: `更多操作：${title}`,
    exact: true,
  });
  await row.hover();
  await more.focus();
  await expect(more).toBeFocused();
  await more.press("Enter");
  const favorite = page.getByRole("menuitem", {
    name: "收藏笔记",
    exact: true,
  });
  await expect(favorite).toBeVisible();
  await favorite.click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "收藏夹", exact: true })
    .click();
  await expect(
    page.locator(".note-item").filter({ hasText: title }),
  ).toBeVisible();
  await expect(row.locator("button button")).toHaveCount(0);
});

test("sidebar and list keep their widths and spacing when the window resizes", async ({
  page,
  request,
}) => {
  await call(request, "updatePreferences", {
    sidebarWidth: 260,
    listWidth: 340,
    sidebarCollapsed: false,
  });
  await page.reload();
  await expect(page.locator(".sidebar")).toHaveCSS("width", "260px");
  let inset: string | undefined;
  for (const width of [1440, 1020, 860, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator(".sidebar")).toHaveCSS("width", "260px");
    await expect(page.locator(".note-list-panel")).toHaveCSS("width", "340px");
    const current = await page
      .locator(".search-box")
      .evaluate((el) => getComputedStyle(el).marginLeft);
    inset ??= current;
    expect(current).toBe(inset);
    await expect(page.locator(".main-nav button span").first()).toBeVisible();
  }
  await page.setViewportSize({ width: 1020, height: 800 });
  await page.getByRole("button", { name: "折叠侧边栏", exact: true }).click();
  for (const width of [860, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator(".sidebar")).toHaveCSS("width", "56px");
    await expect(page.locator(".note-list-panel")).toHaveCSS("width", "340px");
  }
  await call(request, "updatePreferences", {
    sidebarWidth: 200,
    listWidth: 300,
    sidebarCollapsed: false,
  });
});

test("editor stays within the window and column separators support keyboard resizing", async ({
  page,
  request,
}) => {
  await selectFixture(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const separator = page.getByRole("separator", { name: "调整笔记列表宽度" });
  const before = (await page.locator(".note-list-panel").boundingBox())!.width;
  await separator.focus();
  await separator.press("ArrowRight");
  await expect
    .poll(
      async () => (await page.locator(".note-list-panel").boundingBox())!.width,
    )
    .toBeGreaterThan(before);
  for (const width of [860, 1080, 1440]) {
    await page.setViewportSize({ width, height: 760 });
    await expectWithinViewport(page, ".editor-panel");
    await expectWithinViewport(page, ".document-header");
    await expectWithinViewport(page, ".document-editor");
    expect(
      await page
        .locator(".editor-toolbar")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBeTruthy();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
  }
  const saved = await call<Note>(request, "readNote", fixture.path);
  expect(saved.content).toBe(content);
});

test("settings and confirmation dialogs fit smaller windows and keep storage configuration", async ({
  page,
  request,
}) => {
  await selectFixture(page);
  const before = await call<Snapshot>(request, "snapshot");
  await page.setViewportSize({ width: 860, height: 600 });
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await expectWithinViewport(page, ".settings-modal");
  expect(
    await page
      .locator(".settings-modal")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  await page.getByLabel("主题", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "文件存储", exact: true }).click();
  await expect(page.locator(".storage-card code")).toHaveText(
    before.config.root,
  );
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "笔记操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "删除笔记", exact: true }).click();
  await expectWithinViewport(page, ".small-modal");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect((await call<Snapshot>(request, "snapshot")).config.root).toBe(
    before.config.root,
  );
  expect((await call<Note>(request, "readNote", fixture.path)).content).toBe(
    content,
  );
});
