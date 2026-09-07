# dsh-quote-followup — Architecture

This document describes how the plugin is wired into DeepSeek Harness (DSH), how a quote
flows from the transcript into the composer, and why each integration point exists.

## 1. Purpose

`dsh-quote-followup` is a **Web-only** DSH plugin. The user selects text inside the Web
conversation transcript, a floating **❐ 引用** button appears, and clicking it appends the
selection to the composer as a **native DSH conversation-reference chip**. The user can
quote several excerpts and then type a follow-up. On send, the plugin's codec expands each
chip into a model-readable Markdown blockquote.

TUI is intentionally unsupported.

## 2. Package wiring

`package.json` declares the DSH integration:

```json
"main": "lib/index.js",
"dsh": {
  "engines": { "dsh": ">=0.1.2-rc.1" },
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "inject": ["@deepseek-ai/dsh-client-ui-input-trigger"],
    "platform": "web"
  }
}
```

### Host face — `lib/index.js`

```js
export const name = 'quote-followup';
export const inject = [];
export function apply() {}
```

The host entry is deliberately **inert**. Its only job is to let DSH mount the package's
client entry: DSH reads `main` to load the package, then uses the `dsh.client` declaration
to know which browser module to inject. The web client runtime loads `lib/client.js`.

### Bundle patch — `cordis.patch.yml`

```yaml
- insert:
    - id: quote-followup
      name: dsh-quote-followup
```

This inserts the `quote-followup` row into the Web profile bundle so DSH's boot-time
client build knows about the plugin. After changing it, restart `dsh web` and reload/reopen
any tabs that stayed open across the restart.

## 3. Browser client — `lib/client.js`

`lib/client.js` is a single self-contained browser module loaded through
`window.__ModuleLoader__.load({ id, factory })`. It is **pure DOM** (no React, no Lexical,
no framework import); its only injected dependency is DSH's `inputTriggers` service.

It exports:

- `inject: ["inputTriggers"]` — tells the DSH web client runtime that this module depends on
  the `inputTriggers` service. The `package.json` `dsh.client.inject` enables the
  `@deepseek-ai/dsh-client-ui-input-trigger` bundle so `ctx.get("inputTriggers")` exists.
- `apply(ctx)` — the entry point invoked by the web client runtime.

### Constants

| Constant | Meaning |
| --- | --- |
| `TRANSCRIPT_SELECTOR` | `[data-slot="conversation.session"]`, owns the chat transcript (composer excluded). |
| `COMPOSER_SELECTORS` | Ordered composer candidates — official slot first, then legacy hints. |
| `BUTTON_ID` / `BUTTON_VERSION_ATTR` | Shared DOM id + version attr for the floating button. |
| `CLIENT_VERSION` | Must equal `package.json` `version`. |
| `QUOTE_SOURCE` | `"quote-followup"` — codec owner for quote chips. |
| `QUOTE_MAX_CHARS` | `1600` — per-quote character cap. |

## 4. Quote flow

```
 selection (inside transcript)
        │ selectionchange
        ▼
 selectionInTranscript()  ── both anchor & focus in same transcript?
        │  yes, non-collapsed, non-blank text
        ▼
 detectRole()            ── best-effort "user"/"assistant" from data-* / class hints
 pendingQuote = { text, role }
        │
        ▼
 floating button shown (positioned near the selection rect)
        │ click
        ▼
 clear transcript selection BEFORE composer focus   ◄── critical
        │
        ▼
 quotePayload() ── trim + cap (QUOTE_MAX_CHARS) → { text, role, truncated }
        │
        ├──quoteSourceReady && appendQuoteChip()──►  native ReferenceChipNode path
        └──else──────────────────────────────────►  text-blockquote fallback path
```

### 4.1 Native chip path

`appendQuoteChip()` uses the **live Lexical editor** already attached to the composer
(`element.__lexicalEditor`). It reads the registered node classes from `editor._nodes`
(`reference-chip`, `text`, `paragraph`) and runs a single `editor.update(...)` that appends
a `ReferenceChipNode` after the current draft, ensuring a separating space when the draft
doesn't end in whitespace. It places the caret after the chip so the user can type the
question. This reuses the exact same atomic editor entity and UI treatment as `@file` /
`@session` with no second framework.

The plugin also registers a **codec-only source** with `inputTriggers.registerSource(...)`:

```js
{
  trigger: "@",
  name: QUOTE_SOURCE,           // "quote-followup"
  order: 1000,
  candidates: () => Promise.resolve([]),   // owns chips, adds NO @ candidates
  onPick: () => void 0,
  codec: { clipboardText, serialize }
}
```

`serialize` expands each chip's `ref` (a JSON payload) into the Markdown blockquote frame,
and `clipboardText` provides the same projection for copy/paste. This is what makes each
chip readable by the model on send.

### 4.2 Text fallback path

If the native codec is unavailable, `appendToComposer()` appends the text blockquote
(`quoteFrame(payload)`):

- **`<textarea>` / `<input>`** → use the native value setter, dispatch an `input` event,
  and place the caret at the end.
- **contenteditable / Lexical** → focus, place the caret inside the last block, then fall
  through this ladder:
  1. `pasteViaLexical()` — dispatch DSH's `PASTE_COMMAND` through `editor.dispatchCommand`,
     which routes through DSH's own `keyboard.paste` and updates the editor model.
  2. `pasteIntoEditor()` — synthetic `ClipboardEvent("paste")` with `DataTransfer`.
  3. `document.execCommand("insertText")` (legacy fallback).
  4. Raw `Range.insertNode` + an `InputEvent` (last resort).

`pasteViaLexical` is the **primary** contenteditable path because it bypasses browser
security differences around synthetic `clipboardData` while still entering the editor's
model. DOM-level text insertion into a Lexical root does **not** update the editor model.

## 5. Firefox considerations

A constructed `ClipboardEvent` may drop its `clipboardData` argument in Firefox. The code
defensively builds a `DataTransfer`, and if the event comes back without `clipboardData`,
re-attaches it via `Object.defineProperty`. The `pasteViaLexical` path avoids this issue
entirely, which is why it is preferred.

## 6. Singleton & hot-reload takeover

`lib/client.js` uses `Symbol.for("dsh-quote-followup.state")` to store
`{ version, dispose }` on `globalThis`.

- `apply()` no-ops when the mounted state is already `CLIENT_VERSION`.
- Otherwise it calls the previous `dispose()`, re-registers the codec source, re-attaches
  listeners, and stores a fresh state.
- `ensureButton()` replaces a shared-id button whose
  `data-dsh-quote-followup-version` does not match `CLIENT_VERSION`, so a long-lived tab
  cannot keep an obsolete click handler after a hot swap or version bump.

This makes the client idempotent across HMR / repeated `apply` calls and across a server
restart in already-open tabs.

## 7. Test harness

`test/web-repeat-harness.mjs` is a **fake-DOM** harness. It stubs `window`, `document`,
`Element`, `Event`, `ClipboardEvent`, `DataTransfer`, a fake Lexical editor, and a fake
`inputTriggers`. It dynamically imports `lib/client.js` (busting the module cache with a
query string) and asserts:

- `clientModule.inject === ["inputTriggers"]` and `apply` is a function.
- Source is registered as `"quote-followup"`.
- Repeated quoting produces native `ReferenceChipNode` instances with the right source/
  label and correct Markdown in the draft.
- Codec `serialize` matches the chip `clipboardText`.
- Existing draft gets a separating space before the chip.
- Firefox fallback (`native` and `synthetic clipboard` disabled) still appends text quotes.
- A stale shared-id button is replaced by the current client's button.

`npm test` runs `node --check lib/index.js`, `node --check lib/client.js`, then the harness.

## 8. Change checklist

- Editing the client behavior → edit `lib/client.js`, run `npm test`.
- Changing the external contract/version → bump `version` in `package.json` **and**
  `CLIENT_VERSION` in `lib/client.js`.
- Changing the patch/install surface → edit `cordis.patch.yml`, restart `dsh web`, refresh tabs.
- Keeping docs current → update `README.md` and `README.zh.md` together.
