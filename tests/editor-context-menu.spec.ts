import { expect, test } from "@playwright/test";
import type { Note } from "../src/types";

test("selected Markdown text can be formatted from the context menu and undone", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/createNote", {
    data: { args: ["md"] },
  });
  const note = (await response.json()).data as Note;
  await page.goto("/");
  await page
    .getByRole("button", { name: `打开笔记 ${note.title}`, exact: true })
    .click();
  const body = page.getByRole("textbox", { name: "正文", exact: true });
  await body.fill("需要记录的内容");
  await body.press("ControlOrMeta+a");
  await body.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "文本样式", exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "粗体", exact: true }).click();
  await expect(body).toHaveText("**需要记录的内容**");
  await expect(body).toBeFocused();
  await expect(menu).toBeHidden();
  await body.press("ControlOrMeta+z");
  await expect(body).toHaveText("需要记录的内容");

  await body.press("ControlOrMeta+a");
  await body.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "行内代码", exact: true }).click();
  await expect(body).toHaveText("`需要记录的内容`");
  await expect
    .poll(async () => {
      const saved = await request.post("/api/readNote", {
        data: { args: [note.path] },
      });
      return (await saved.json()).data.content;
    })
    .toBe("`需要记录的内容`");
  await body.press("ControlOrMeta+a");
  await body.click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(body).toBeFocused();

  await body.press("ArrowRight");
  await body.click({ button: "right" });
  await expect(menu).toBeHidden();

  await body.press("ControlOrMeta+a");
  await body.dispatchEvent("contextmenu", { clientX: 1270, clientY: 710 });
  await expect(menu).toBeVisible();
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width - 7,
  );
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - 7,
  );
  await page.keyboard.press("End");
  await expect(
    menu.getByRole("menuitem", { name: "行内代码", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");

  const txtResponse = await request.post("/api/createNote", {
    data: { args: ["txt"] },
  });
  expect(txtResponse.ok()).toBeTruthy();
  await page.reload();
  await page
    .locator(".note-item")
    .filter({ has: page.locator(".type-badge", { hasText: "TXT" }) })
    .locator(".note-select")
    .click();
  await body.fill("纯文本");
  await body.press("ControlOrMeta+a");
  await body.click({ button: "right" });
  await expect(menu).toBeHidden();
});
