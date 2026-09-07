# dsh-quote-followup

English | [中文](README.zh.md)

[![npm version](https://img.shields.io/npm/v/dsh-quote-followup.svg)](https://www.npmjs.com/package/dsh-quote-followup)
[![license](https://img.shields.io/npm/l/dsh-quote-followup.svg)](LICENSE)

A Web-only [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for quoting selected conversation text into the composer and asking a focused follow-up.

<p align="center">
  <img src="docs/assets/quote-followup-demo.gif" width="960" alt="Select conversation excerpts, insert native DSH quote chips, and write a focused follow-up">
</p>

<p align="center"><strong>Select. Quote. Follow up.</strong></p>

## Features

- Select text inside the Web conversation transcript to reveal a floating **Quote** button.
- Append a native DSH conversation-reference chip without replacing the existing draft.
- Reuse the same atomic `ReferenceChipNode`, conversation icon, and business color as `@file` / `@session`.
- Keep each chip compact by showing only the excerpt; the bubble icon already conveys that it is a quote.
- Follow the active DSH locale for the floating action and serialized quote frame.
- Attach the conversation turn number to the serialized frame when the selection comes from a DSH chat row, so follow-ups like "revisit turn 3" stay resolvable. Selections without a turn marker keep the provenance-free frame.
- Quote multiple excerpts; on send, the plugin codec expands each chip into a model-readable Markdown blockquote.
- Fall back to a plain-text quote when the host lacks native chip support.

TUI is intentionally unsupported.

## Scope

This is a Web client-side extension. The composer and send path are owned by the browser client: chips exist only in the Lexical editor, and the model only ever sees the Markdown blockquotes the codec expands at send time — never the chips themselves. No host-side plugin surface is involved.

Chips are text-only by design. They carry the excerpt, a display-only role hint, the conversation turn ordinal when it is available, and a truncation flag — no global session-message references — so they stay valid across compaction folds and session rotation.


## Install

Requires DSH `>=0.1.2-rc.1`.

```bash
dsh plugin --profile web add dsh-quote-followup
```

Add `dsh-quote-followup` to the Web profile's `dsh.profile.bundles`, then restart `dsh web` so the server rebuilds its boot-time client bundle. Reload or reopen browser tabs that stayed open across the restart; their already-loaded JavaScript cannot update itself from a new server process.

## Use

1. Select text in a conversation message.
2. Click **❐ Quote**.
3. Select and quote more excerpts if needed.
4. Type the follow-up after the inserted chips and send.

## Development

```bash
npm test
```

The regression harness covers compact native quote chips, locale switching, turn-number provenance with graceful degradation, repeated quoting, spacing after an existing draft, codec serialization, the Firefox text fallback, and current-client takeover of stale singleton/button state after a hot swap.

## License

MIT
