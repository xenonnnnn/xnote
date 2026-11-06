import { test, expect, type Locator } from "@playwright/test";
import type { Note } from "../src/types";

for (const theme of ["light", "dark"] as const) {
  test(`${theme} controls share hover and selected backgrounds`, async ({
    page,
    request,
  }) => {
    const call = async (method: string, ...args: unknown[]) => {
      const response = await request.post(`/api/${method}`, { data: { args } });
      expect(response.ok()).toBeTruthy();
      return (await response.json()).data;
    };
    await call("updatePreferences", {
      theme,
      sidebarCollapsed: false,
      restoreLastNote: false,
    });
    const note: Note = await call("createNote", "md");
    await page.goto("/");
    const hover = theme === "light" ? "rgb(245, 245, 245)" : "rgb(44, 44, 44)";
    const selected =
      theme === "light" ? "rgb(238, 238, 238)" : "rgb(56, 56, 56)";
    const checkHover = async (control: Locator) => {
      await control.hover();
      await expect(control).toHaveCSS("background-color", hover);
    };
    await checkHover(page.locator(".welcome .primary-button"));
    await expect(page.locator(".welcome .primary-button")).toHaveCSS(
      "color",
      theme === "light" ? "rgb(41, 41, 41)" : "rgb(227, 227, 227)",
    );
    await checkHover(page.locator(".list-top").getByRole("button", { name: "新建笔记", exact: true }));
    await checkHover(
      page.getByRole("button", { name: "最近编辑", exact: true }),
    );
    await checkHover(
      page.getByRole("button", { name: "新建文件夹", exact: true }),
    );
    await page
      .getByRole("button", { name: "新建笔记", exact: true })
      .first()
      .click();
    await checkHover(page.getByRole("menuitem", { name: "Markdown" }));
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: `打开笔记 ${note.title}`, exact: true })
      .click();
    await checkHover(page.getByRole("button", { name: "粗体", exact: true }));
    await page.getByRole("button", { name: "粗体", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "粗体", exact: true }),
    ).toHaveCSS("background-color", selected);
    await expect(page.locator(".note-item.active")).toHaveCSS(
      "background-color",
      hover,
    );
    await page.getByRole("button", { name: "收藏笔记", exact: true }).click();
    const favorite = page.getByRole("button", {
      name: "取消收藏",
      exact: true,
    });
    await favorite.hover();
    await expect(favorite).toHaveCSS("background-color", hover);
    await expect(favorite.locator("svg")).toHaveAttribute("fill", "currentColor");
    await page.getByRole("textbox", { name: "搜索笔记", exact: true }).focus();
    await page.mouse.move(1, 1);
    await expect(favorite).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator(".editor-toolbar")).toHaveCSS("opacity", "1");
    await page.getByRole("button", { name: "模板", exact: true }).click();
    await checkHover(page.locator(".template-item button").first());
    await expect(
      page.getByRole("button", { name: "模板", exact: true }),
    ).toHaveCSS("background-color", selected);
    await page.getByRole("button", { name: "模板", exact: true }).hover();
    await expect(
      page.getByRole("button", { name: "模板", exact: true }),
    ).toHaveCSS("background-color", selected);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await checkHover(
      page.getByRole("button", { name: "文件存储", exact: true }),
    );
    await expect(page.locator(".settings-nav button.active")).toHaveCSS(
      "background-color",
      selected,
    );
    await checkHover(page.getByRole("combobox", { name: "主题", exact: true }));
    const toggle = page.locator(".switch");
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveCSS("background-color", selected);
    await toggle.hover();
    await expect(toggle).toHaveCSS("background-color", selected);
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    const current = await call("readNote", note.path);
    await call("deleteNote", current.path, current.revision);
  });
}
