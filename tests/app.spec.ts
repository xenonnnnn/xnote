import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
const home = process.env.XNOTE_HOME || "/tmp/xnote-e2e";
test("real files survive editing, searching, preview, favorites and reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "给想法一个落脚点" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "新建笔记", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Markdown" }).click();
  const title = page.getByRole("textbox", { name: "笔记标题" });
  await title.fill("每日记录");
  await title.press("Enter");
  await expect(page.getByText("所有更改已保存", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toBeFocused();
  const editor = page.getByRole("textbox", { name: "正文", exact: true });
  await editor.fill("# 今天\n\n记下一个清晰的想法。");
  await expect(page.getByText("所有更改已保存", { exact: true })).toBeVisible();
  await expect
    .poll(async () =>
      fs
        .readFile(path.join(home, "notes", "每日记录.md"), "utf8")
        .catch(() => ""),
    )
    .toContain("清晰的想法");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收藏笔记", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索笔记" }).fill("清晰");
  await expect(page.locator(".note-item")).toHaveCount(1);
  await page.reload();
  await expect(title).toHaveValue("每日记录");
  await fs.writeFile(path.join(home, "notes", "每日记录.md"), "外部编辑器更新");
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveText("外部编辑器更新", { timeout: 10000 });
});
test("folder creation, TXT, settings, theme and confirmed deletion", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
  await page.getByRole("textbox", { name: "文件夹名称" }).fill("工作");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("button", { name: "工作", exact: true }).click();
  await page
    .getByRole("button", { name: "新建笔记", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "纯文本" }).click();
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveValue(
    "Untitled",
  );
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .fill("真实的纯文本");
  await expect(page.getByText("所有更改已保存", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      fs
        .readFile(path.join(home, "notes", "工作", "Untitled.txt"), "utf8")
        .catch(() => ""),
    )
    .toBe("真实的纯文本");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("主题").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.getByRole("button", { name: "笔记操作" }).click();
  await page.getByRole("menuitem", { name: "删除笔记" }).click();
  await page.getByRole("button", { name: "删除文件", exact: true }).click();
  await expect
    .poll(() =>
      fs.access(path.join(home, "notes", "工作", "Untitled.txt")).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);
});

test("late input during save reaches disk before switching and collision retry stays usable", async ({
  page,
}) => {
  await page.goto("/");
  async function create(title: string) {
    await page
      .getByRole("button", { name: "新建笔记", exact: true })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Markdown" }).click();
    const input = page.getByRole("textbox", { name: "笔记标题" });
    await input.fill(title);
    await input.press("Enter");
    await expect(
      page.getByText("所有更改已保存", { exact: true }),
    ).toBeVisible();
  }
  await create("目标笔记");
  await create("保存竞争");
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(
    "**/api/saveNote",
    async (route) => {
      started();
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  const body = page.getByRole("textbox", { name: "正文", exact: true });
  await body.fill("第一次输入");
  await pending;
  await body.fill("保存请求期间的新输入");
  release();
  await page.locator(".note-item").filter({ hasText: "目标笔记" }).click();
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveValue(
    "目标笔记",
  );
  await expect
    .poll(() =>
      fs
        .readFile(path.join(home, "notes", "保存竞争.md"), "utf8")
        .catch(() => ""),
    )
    .toBe("保存请求期间的新输入");
  await page.locator(".note-item").filter({ hasText: "保存竞争" }).click();
  const title = page.getByRole("textbox", { name: "笔记标题" });
  await title.fill("目标笔记");
  await body.fill("正文已保存但重名");
  await expect(
    page.getByText("保存失败 · 点击重试", { exact: true }),
  ).toBeVisible();
  await title.fill("恢复后笔记");
  await title.press("Enter");
  await expect(page.getByText("所有更改已保存", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      fs
        .readFile(path.join(home, "notes", "恢复后笔记.md"), "utf8")
        .catch(() => ""),
    )
    .toBe("正文已保存但重名");
});

test("external change after delete confirmation is protected; local images preview", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "全部笔记", exact: false }).click();
  await page
    .getByRole("button", { name: "新建笔记", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Markdown" }).click();
  const title = page.getByRole("textbox", { name: "笔记标题" });
  await title.fill("冲突保护");
  await title.press("Enter");
  await fs.writeFile(
    path.join(home, "notes", "pixel.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .fill("![本地图片](pixel.png)");
  await expect(page.getByText("所有更改已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByRole("img", { name: "本地图片" })).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  await page.getByRole("button", { name: "笔记操作" }).click();
  await page.getByRole("menuitem", { name: "删除笔记" }).click();
  await fs.writeFile(
    path.join(home, "notes", "冲突保护.md"),
    "外部尚未看过的更新",
  );
  await page.getByRole("button", { name: "删除文件", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("文件已被其他程序修改");
  expect(
    await fs.readFile(path.join(home, "notes", "冲突保护.md"), "utf8"),
  ).toBe("外部尚未看过的更新");
});

test("storage migration copies real files, preserves originals and persists new directory", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "文件存储", exact: true }).click();
  await page.getByLabel("新目录的完整路径").fill(path.join(home, "migrated"));
  await page.getByRole("radio", { name: /迁移现有笔记/ }).check();
  await page.getByText("目录不存在时创建", { exact: true }).click();
  await page.getByRole("button", { name: "继续迁移" }).click();
  await expect(
    page.getByText("确认将文件复制到", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认迁移" }).click();
  await expect(page.locator(".storage-card code")).toHaveText(
    path.join(await fs.realpath(home), "migrated"),
  );
  expect(
    await fs.readFile(path.join(home, "notes", "每日记录.md"), "utf8"),
  ).toBe("外部编辑器更新");
  expect(
    await fs.readFile(path.join(home, "migrated", "每日记录.md"), "utf8"),
  ).toBe("外部编辑器更新");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "文件存储", exact: true }).click();
  await expect(page.locator(".storage-card code")).toHaveText(
    path.join(await fs.realpath(home), "migrated"),
  );
});
