# 模板中心验证记录

验证日期：2026-11-05（America/New_York）。

## 实现范围

- 保留 React / Electron / Express 文件服务、三栏布局、CodeMirror 编辑器、原有存储目录与自动保存流程。
- 导航新增「模板」，14px 文字及 16px 线性图标，沿用黑白灰交互样式。
- 模板中心在右侧主区域展示四个配置驱动的内置模板；中间仍可浏览笔记。
- Q&A、学习、代码模板正文按需求初始化；空白模板正文严格为零字节。
- 服务端统一解析模板并创建标准 `.md`，重名递增且独占创建；模板正文先写完整再发布。
- 应用分类存在现有 `config.json` 的 `noteTypes`，正文不含 JSON 或专有格式。普通 Markdown 不按内容猜测类型。
- 类型随应用内重命名、删除和目录迁移更新；切换到其他目录清除原目录分类映射。
- 列表沿用 12px 浅灰文字，显示 Q&A / MD / TXT。
- 编辑器复用原有 Markdown 功能，并为 JS/TS/JSX/TSX 围栏代码补充语言高亮；其他语言继续正常编辑及呈现。使用已安装的 CodeMirror JavaScript 包，未安装额外包。

## 自动化结果

| 检查                   | 结果                                             |
| ---------------------- | ------------------------------------------------ |
| `npm test`             | 75/75 通过，真实文件、存储回归、模板与编辑器测试 |
| `npm run typecheck`    | 通过                                             |
| `npm run build`        | 通过，生成 Web 与 Electron 构建                  |
| 浏览器端到端           | 24/24 通过，原有 16 项及新增模板 8 项，26.6 秒   |
| 原生 Electron 模板验证 | 通过，真实 IPC 与本地文件                        |

## 验收覆盖

- 四种模板内容逐字匹配需求，文件扩展名 `.md`，空白模板没有标题或占位正文。
- 同名文件、目录、符号链接占用名称及并发创建均不覆盖已有内容。
- 配置写入失败回滚本次文件；外部程序已经修改的文件保留，不当作重名反复创建。
- Q&A 可以自由替换正文，支持标题、粗体、斜体、列表、引用、行内代码、代码块、链接、图片、表格与分割线。
- 自动保存、改名、重新打开和重启后正文及分类保持完整；普通相同内容 Markdown 仍显示 MD。
- 收藏、最近编辑、搜索、文件夹及原有 MD/TXT 创建保存通过回归覆盖。
- 模板页面往返保留原编辑器实例及撤销历史；Q&A 副本保留分类。
- 创建失败提示明确，页面保留；创建成功后的列表刷新失败单独提示，仍进入已创建笔记，避免重复创建。
- 连续点击使用模板由既有 workspace transition 锁阻止重叠创建。
- 普通 MD/TXT 继续使用原有 `wx` 独占创建；测试模拟硬链接不支持时仍能创建普通笔记。

## 实际运行与截图

通过 Playwright 启动 Chrome、本地开发服务和原生 Electron；所有数据均位于临时 `XNOTE_HOME`，未操作用户笔记目录。

最终浏览器回归数据目录：`/tmp/xnote-template-verified-eBE5GY`。最终原生 Electron 验证数据目录：`/tmp/xnote-templates-desktop-SC9au1`。

- [桌面模板中心](template-center-desktop.png)
- [桌面 Q&A 预览](template-qa-desktop.png)
- [宽窗口模板中心](template-center-light.png)
- [窄窗口模板中心](template-center-narrow.png)

复验命令（Node.js 22.12+）：

```sh
npm test
npm run typecheck
npm run build
XNOTE_HOME="$(mktemp -d /tmp/xnote-template-e2e-XXXXXX)" XNOTE_WEB_PORT=5193 XNOTE_API_PORT=4338 XNOTE_BROWSER_CHANNEL=chrome npm run test:e2e
node --import tsx scripts/test-templates-desktop.ts
```

模板原生验证脚本独立运行，不覆盖既有桌面截图。桌面截图已关闭动画并目视检查三栏、选中状态、留白和 Q&A 标识。

## 已知边界

模板分类属于本机应用配置，单独复制 Markdown 到其他笔记库或在外部移动文件不会携带该分类，正文保持完整。模板创建沿用文件服务已经使用的硬链接发布方式，在不支持硬链接的卷上会明确失败；普通 MD/TXT 创建保留原兼容性。已验证本机 macOS 的 Chrome 与 Electron，未实机验证 Windows/Linux。
