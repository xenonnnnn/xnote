import { _electron as electron, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

const testHome = await fs.mkdtemp("/tmp/xnote-window-controls-");
const env: Record<string, string> = Object.fromEntries(
  Object.entries({ ...process.env, XNOTE_HOME: testHome }).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.XNOTE_DEV_URL;
const application = await electron.launch({
  args: [".", `--user-data-dir=${testHome}/electron`],
  env,
});
try {
  const page = await application.firstWindow();
  const controls = page.getByRole("group", { name: "窗口控制" });
  await expect(controls).toBeVisible({ timeout: 5000 });
  const bounds = await controls.locator("button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const { x, y, width, height } = button.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  expect(bounds).toEqual([
    { x: 6, y: 6, width: 12, height: 12 },
    { x: 24, y: 6, width: 12, height: 12 },
    { x: 42, y: 6, width: 12, height: 12 },
  ]);
  await page.screenshot({
    path: "/tmp/xnote-window-controls.png",
    animations: "disabled",
  });
  await controls.getByRole("button", { name: "最小化窗口" }).click();
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMinimized(),
      ),
    )
    .toBe(true);
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.restore();
    window.focus();
  });
  const fullscreen = controls.getByRole("button", { name: "切换全屏" });
  await fullscreen.click();
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isFullScreen(),
      ),
    )
    .toBe(true);
  await fullscreen.click();
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isFullScreen(),
      ),
    )
    .toBe(false);
  await fullscreen.click({ modifiers: ["Alt"] });
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    )
    .toBe(true);
  await fullscreen.click({ modifiers: ["Alt"] });
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    )
    .toBe(false);
  await page.getByRole("button", { name: "模板", exact: true }).click();
  await page
    .getByRole("button", { name: "使用 Q&A 笔记模板", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .fill("关闭窗口前的修改");
  const closed = page.waitForEvent("close");
  await controls.getByRole("button", { name: "关闭窗口" }).click();
  await closed;
  expect(
    await fs.readFile(path.join(testHome, "notes", "新建问答.md"), "utf8"),
  ).toBe("关闭窗口前的修改");
  console.log(
    "macOS window controls: exact geometry, minimize, fullscreen and save before close passed",
  );
} finally {
  await application.close();
}
