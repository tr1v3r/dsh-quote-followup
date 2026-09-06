# dsh-quote-followup

English | [中文](README.zh.md)

Quote **selected conversation content** into a **targeted follow-up turn** —
one dsh plugin package, two faces:

- **dsh-TUI face**: `Ctrl+Alt+Q` opens a message picker (recent user/assistant
  messages, newest first); each pick appends a quote block into the prompt
  input — repeatable, editable before sending.
- **Web face (dsh web)**: **select any text span** in the transcript, click the
  floating "❐ 引用" button, and the quote block lands at the composer's caret.

The quote is a plain markdown blockquote (`> [引用 · assistant#5]`) —
**visible, editable, no hidden injection**: the model sees exactly what you
see in the input box.

## How it works (public seams only, zero core patches)

| Stage | TUI face | Web face |
| --- | --- | --- |
| Message source | `session/event` firehose (the ecosystem template's sanctioned seam), buffered per session | live transcript DOM in the browser |
| Entry interaction | `ctx.tuiShortcuts` (global combo) + `ctx.tuiDialogs` (picker) | native text selection + floating button |
| Writing the input | the dsh.nvim injection socket contract (`~/.dsh-tui/inject/<sessionId>.sock`, `prompt.append`) | direct composer element writes (native setter + input event) |
| Feedback | `ctx.tuiToast` | console warnings on failure only |

Component admission / `tui/input` interception are deliberately **not** used:
as of dsh-TUI 0.10.x the admission capability has no public production entry
(the `plugin-host` shim does not export it; test-utils is marked test-only),
and the intercept-class permission that rewrites submitted input is
deny-by-default. The selection→input-box pattern needs neither, matches the
Web face behavior, and stays fully transparent to the user.

## Install

```sh
# TUI profile
dsh plugin --profile dsh-tui add dsh-quote-followup
# Web profile (the browser half loads via the dsh.client declaration;
# restart dsh web)
dsh plugin --profile web add dsh-quote-followup
```

Add `dsh-quote-followup` to `dsh.profile.bundles` and restart. No grants file
(`extension-grants.json`), no TUI patches.

## Usage

### TUI

**Selection quoting (recommended — matches the Web face)**: in fullscreen,
dsh-TUI's copy-on-select copies any mouse selection to the clipboard and
clears the highlight. After selecting, press `Ctrl+Alt+Q` — the **first
picker row is exactly the text you just selected** (`📋 划选/剪贴板 · …`);
Enter quotes it.

**Whole-message quoting**: `Ctrl+Alt+Q` → picker lists recent messages
(`#seq me/assistant · summary`, arrows + Enter); mixes freely with the
selection row and repeats.

Type your question below the quote blocks and send.

> Combo delivery note: the TUI enables the kitty keyboard protocol, so
> `Ctrl+Alt+Q` arrives reliably as CSI-u on modern terminals (iTerm2 3.5+,
> kitty, WezTerm, Ghostty, …). If your terminal does not deliver the combo,
> remap `shortcut` in the row config to any ctrl/alt combo it does deliver.

### Web (dsh web GUI)

1. Select any span in the transcript (cross-line, any granularity).
2. The "❐ 引用" button appears above the selection — click it.
3. The quote block is appended to the composer; keep quoting or type your
   question, then send.

## Configuration (optional row config override)

Patch rows replace the whole `config`, so restate every key when overriding:

```yaml
- id: quote-followup
  name: dsh-quote-followup
  config:
    shortcut: ctrl+alt+q        # needs ctrl or alt; avoid reserved combos
    pickerLimit: 30             # max messages listed
    quoteMaxChars: 1600         # per-quote truncation bound (chars)
    clipboardReadCommand: ''    # optional custom clipboard reader (/bin/sh -c;
                                # default probes pbpaste / wl-paste / xclip / xsel)
```

## Known edges

- **Live messages only**: `session/event` does not replay history (resume
  seeds do not emit), so messages from before a `/resume` or restart never
  appear in the picker.
- **Picker target session**: the TUI face targets the session of the latest
  user message; pressing the combo immediately after `/resume` (before any new
  message) may list the previous session's buffer.
- **Role detection (Web)**: best-effort heuristics; unknown roles are labeled
  "对话".
- The Web face writes input-box text — what you see is what the model gets.
  Thinking / tool calls are not quotable.

## Development

```sh
git clone <repo> && cd dsh-quote-followup
dsh plugin --profile dsh-tui add link:$(pwd)
dsh plugin --profile web add link:$(pwd)
```

Pure ESM, zero runtime dependencies; `lib/index.js` (host half, Node) +
`lib/client.js` (browser half, a `window.__ModuleLoader__` closure factory).
A headless E2E harness mounts the real extensions row plus this plugin and
drives session/event → shortcut → dialog → injection socket end to end.

## License

MIT
