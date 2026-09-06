# dsh-quote-followup

[English](README.md) | 中文

把**选中的对话内容**引用进**针对性的下一轮追问**——同一个 dsh 插件包，两张界面：

- **dsh-TUI 面**：`Ctrl+Alt+Q` 打开消息选择器（最近的用户/助手消息，最新在前），
  选中后引用块直接落入输入框，可多次追加、发送前可编辑。
- **Web 面（dsh web）**：在对话记录里**划选任意文本片段**，出现浮动「❐ 引用」按钮，
  点击后引用块插入输入框光标处。

引用块是普通的 markdown blockquote（`> [引用 · assistant#5]`），**可见、可编辑、
无隐藏注入**——模型看到的就是你在输入框里看到的内容。

## 工作原理（全部走公开插件缝，零核心 patch）

| 环节 | TUI 面 | Web 面 |
| --- | --- | --- |
| 消息来源 | `session/event` 事件流（生态模板认可的标准接缝），按会话缓冲 | 浏览器实时读取 transcript DOM |
| 入口交互 | `ctx.tuiShortcuts`（全局快捷键）+ `ctx.tuiDialogs`（选择弹窗） | 原生文本选区 + 浮动按钮 |
| 写入输入框 | dsh.nvim 约定的注入套接字（`~/.dsh-tui/inject/<sessionId>.sock`，`prompt.append`） | 直接操作 composer 输入元素（原生 setter + input 事件） |
| 提示反馈 | `ctx.tuiToast` | 控制台警告（仅失败时） |

刻意**不使用** Component admission / `tui/input` 拦截：当前（dsh-TUI 0.10.x）
准入能力没有公开的生产入口（`plugin-host` shim 不导出、test-utils 标注 test-only），
改写已提交输入的拦截类权限也默认拒绝。选区→输入框的模式不需要其中任何一个，
而且与 Web 面行为一致、对用户完全透明。

## 安装

```sh
# TUI profile
dsh plugin --profile dsh-tui add dsh-quote-followup
# Web profile（浏览器半区由 dsh.client 声明自动加载，需重启 dsh web）
dsh plugin --profile web add dsh-quote-followup
```

bundle 清单（`dsh.profile.bundles`）加上 `dsh-quote-followup` 后重启即生效。
无需授权文件（`extension-grants.json`）、无需任何 TUI patch。

## 使用

### TUI

1. 正常对话（消息进入缓冲）。
2. `Ctrl+Alt+Q` → 选择器列出最近消息（`#序号 我/助手 · 摘要`，方向键 + Enter）。
3. 引用块落入输入框；可再次 `Ctrl+Alt+Q` 追加多条。
4. 在引用块下方写下问题，正常发送。

### Web（dsh web GUI）

1. 在对话记录中划选任意片段（支持跨行，任意粒度）。
2. 选区上方出现「❐ 引用」按钮，点击。
3. 引用块追加到输入框末尾（多次引用多次追加），继续输入问题后发送。

## 配置（可选，覆盖行 config）

`cordis.patch.yml` 的行 config 整体替换语义，覆盖时需完整重述：

```yaml
- id: quote-followup
  name: dsh-quote-followup
  config:
    shortcut: ctrl+alt+q   # 需带 ctrl 或 alt；避开保留组合
    pickerLimit: 30        # 选择器列出的消息数上限
    quoteMaxChars: 1600    # 单条引用的截断上限（字符）
```

## 已知边界

- **只有 live 消息可引用**：`session/event` 不回放历史（resume 的种子事件不发出），
  `/resume` 或重启后、第一条新消息之前的旧消息不出现在选择器里。
- **选择器目标会话**：TUI 面以「最近一条用户消息所在的会话」为准；`/resume` 后
  立即按 `Ctrl+Alt+Q`（还没有新消息时）可能列出上一会话的缓冲。
- **角色识别（Web）**：best-effort（data-role/class 启发式），识别不了标注为「对话」。
- Web 面的注入走输入框文本，所见即所得； Thinking / 工具调用不在可引用范围。

## 开发

```sh
git clone <repo> && cd dsh-quote-followup
dsh plugin --profile dsh-tui add link:$(pwd)
dsh plugin --profile web add link:$(pwd)
```

- 纯 ESM、零运行时依赖；`lib/index.js`（host 半区，Node）+ `lib/client.js`
  （浏览器半区，`window.__ModuleLoader__` 闭包工厂）。
- 无头 E2E：挂载真实 extensions 行 + 本插件行，驱动 session/event →
  快捷键 → 弹窗 → 注入套接字全链路（见仓库 docs/harness 说明）。

## License

MIT
