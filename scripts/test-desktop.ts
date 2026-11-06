import { _electron as electron, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
const testHome = await fs.mkdtemp("/tmp/xnote-desktop-");
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
    .poll(() => page.evaluate(() => typeof window.xnote?.chooseDirectory))
    .toBe("function");
  await page
    .getByRole("button", { name: "新建笔记", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Markdown" }).click();
  const title = page.getByRole("textbox", { name: "笔记标题" });
  await title.fill("桌面验证");
  await title.press("Enter");
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .fill("# 原生桌面\n文件确实保存在本地。");
  await expect(page.getByText("所有更改已保存", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      fs.readFile(`${testHome}/notes/桌面验证.md`, "utf8").catch(() => ""),
    )
    .toContain("文件确实保存在本地");
  await page.screenshot({ path: "docs/desktop-light.png" });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("主题").selectOption("dark");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.screenshot({ path: "docs/desktop-dark.png" });
  expect(errors).toEqual([]);
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .fill("关闭窗口前的最终内容");
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await expect
    .poll(() =>
      fs.readFile(`${testHome}/notes/桌面验证.md`, "utf8").catch(() => ""),
    )
    .toBe("关闭窗口前的最终内容");
  console.log(
    `Electron smoke PASS: IPC, real files, light/dark, close flush. Test directory: ${testHome}`,
  );
} finally {
  await application.close();
}
