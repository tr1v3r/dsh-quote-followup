# dsh-quote-followup

English | [中文](README.zh.md)

A Web-only [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for quoting selected conversation text into the composer and asking a focused follow-up.

## Features

- Select text inside the Web conversation transcript to reveal a floating **Quote** button.
- Append the selection as a Markdown quote without replacing the existing draft.
- Repeat the action to collect multiple excerpts before sending.
- Keep the Lexical editor model and rendered composer in sync.

TUI is intentionally unsupported.

## Install

```bash
dsh plugin --profile web add dsh-quote-followup
```

Add `dsh-quote-followup` to the Web profile's `dsh.profile.bundles`, then restart `dsh web` so the server rebuilds its boot-time client bundle.

## Use

1. Select text in a conversation message.
2. Click **❐ Quote**.
3. Select and quote more excerpts if needed.
4. Type the follow-up below the inserted quotes and send.

## Development

```bash
npm test
```

The regression harness models the Lexical boundary that caused the historical “first quote works, second quote disappears” bug: once the editor has a block, the caret must be inside its last block rather than after the block at the editor root.

## License

MIT
