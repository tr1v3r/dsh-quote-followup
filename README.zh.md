# dsh-quote-followup

[English](README.md) | 中文

一个仅支持 Web 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：选中对话文本，将其追加到输入框，再进行针对性追问。

## 功能

- 在 Web 对话区选中文本后显示浮动的 **❐ 引用** 按钮。
- 以 Markdown 引用块追加到现有草稿，不覆盖已输入内容。
- 可连续引用多段内容，再统一编辑并发送。
- 通过 Lexical 的 paste 路径更新编辑器模型，避免只改 DOM。

本插件不再适配 TUI。

## 安装

```bash
dsh plugin --profile web add dsh-quote-followup
```

将 `dsh-quote-followup` 加入 Web profile 的 `dsh.profile.bundles`，然后重启 `dsh web`，让服务端重新生成启动时缓存的 client bundle。仅刷新页面不会替换旧服务进程中的 bundle。

## 使用

1. 在对话消息中划选任意片段。
2. 点击 **❐ 引用**。
3. 如需补充，可继续选中并引用其他片段。
4. 在引用块下输入追问并发送。

## 开发验证

```bash
npm test
```

回归测试覆盖历史问题：“第一次引用成功，第二次消失”。根因是编辑器已有段落后，caret 不能放在 Lexical root 的 block 之后，必须放进最后一个 block 内。

## 许可证

MIT
