import { expect, test } from "@playwright/test";
import type { Note } from "../src/types";

test("editor actions show readable tooltips above icons and preserve editing", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/createNote", {
    data: { args: ["md"] },
  });
  expect(response.ok()).toBeTruthy();
  const note = (await response.json()).data as Note;
  await page.goto("/");
  await page
    .getByRole("button", { name: `打开笔记 ${note.title}`, exact: true })
    .click();
  const body = page.getByRole("textbox", { name: "正文", exact: true });
  await expect(body).toBeVisible();
  const hints = [
    ["二级标题", "二级标题"],
    ["粗体", "粗体 · ⌘B / Ctrl+B"],
    ["斜体", "斜体 · ⌘I / Ctrl+I"],
    ["无序列表", "无序列表"],
    ["引用", "引用"],
    ["插入链接", "插入链接 · ⌘K / Ctrl+K"],
    ["插入图片链接", "插入图片链接"],
    ["代码块", "代码块"],
    ["分割线", "分割线"],
    ["显示 Markdown 源码", "显示完整 Markdown 源码"],
    ["编辑", "编辑"],
    ["预览", "预览"],
    ["分屏预览", "分屏预览"],
    ["收藏笔记", "收藏笔记"],
    ["笔记操作", "笔记操作"],
  ];
  for (const [name, text] of hints) {
    const button = page.getByRole("button", { name, exact: true });
    await button.hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toHaveText(text);
    await expect(tip).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(tip).toHaveCSS("background-color", "rgb(67, 70, 77)");
    await expect(button).toHaveAttribute(
      "aria-describedby",
      (await tip.getAttribute("id")) as string,
    );
    const anchor = (await button.boundingBox())!;
    const bounds = (await tip.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(8);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(
      page.viewportSize()!.width - 7,
    );
    if (name !== "收藏笔记" && name !== "笔记操作") {
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(anchor.y - 7);
    }
    await page.mouse.move(1, 1);
    await expect(tip).toHaveCount(0);
  }
  const bold = page.getByRole("button", { name: "粗体", exact: true });
  await body.focus();
  await bold.focus();
  await expect(page.getByRole("tooltip")).toContainText("粗体");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await bold.click();
  await body.pressSequentially("内容");
  await expect(body).toHaveText("**内容**");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});
