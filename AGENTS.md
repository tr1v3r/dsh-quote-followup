# AGENTS.md

Agent-facing project instructions for **dsh-quote-followup**.

> This repository is a Web-only [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin.
> It lets the user select text inside the Web conversation transcript and append it to
> the composer as a quote chip, then type a targeted follow-up.

- **Language of code and docs:** English (comments in `lib/client.js` are English).
- **Scope:** Web client only. TUI is intentionally unsupported and out of scope.

## Layout

| Path | Role |
| --- | --- |
| `lib/index.js` | Host face. Inert by design; exists so DSH mounts the package's `dsh.client` web entry. |
| `lib/client.js` | The entire feature. Hand-written browser module loaded via `window.__ModuleLoader__.load`. |
| `lib/index.d.ts` | Type declarations for the host entry. |
| `cordis.patch.yml` | Web profile bundle patch that inserts the `quote-followup` row. |
| `test/web-repeat-harness.mjs` | Self-contained fake-DOM regression harness for `lib/client.js`. |
| `package.json` | Package metadata, `dsh` wiring, `npm test`, publishes `/lib` + `cordis.patch.yml`. |
| `README.md`, `README.zh.md` | User-facing docs. Keep in sync with each other. |
| `ARCHITECTURE.md` | Deep-dive on the runtime architecture, integration and fallback paths. |

## Commands

```bash
npm test            # node --check lib/index.js && node --check lib/client.js && node test/web-repeat-harness.mjs
node --check lib/client.js   # quick syntax check
git status          # confirm only intended files changed
```

There is **no build step**. `lib/client.js` is the shipped source; do not introduce
Transpile/Bundler output into the repo.

## Non-negotiable invariants

1. **No framework.** `lib/client.js` is pure DOM and carries no React/Lexical runtime.
   Its module-level export is `inject: ["inputTriggers"]` plus an `apply(ctx)` function.
   Never import a second React or Lexical instance.
2. **Web-only.** If a change only makes sense on the timeline of a TUI, it does not belong here.
3. **Don't mutate the transcript selection before composer focus.** Clear the transcript
   range **before** focusing the composer; clearing it after insertion destroys Lexical's
   caret and makes the next quote unreliable.
4. **DOM text is not editor state.** For contenteditable/Lexical composers, never insert
   raw text only via DOM. The primary path is DSH's registered `PASTE_COMMAND`
   (`editor.dispatchCommand`). The synthetic `ClipboardEvent` / `execCommand` / `insertNode`
   calls are **fallbacks only**.
5. **Firefox heap:** a constructed `ClipboardEvent` may drop its `clipboardData`.
   Construct a `DataTransfer`, and if the event loses it, re-attach it with
   `Object.defineProperty`. The Lexical paste command path avoids this entirely.
6. **Version gating.** `CLIENT_VERSION` in `lib/client.js` must equal `package.json`
   `version`. `apply()` no-ops when the mounted state is the same version, disposes a
   previous one otherwise, and `ensureButton()` takes over a stale shared-id button via
   `data-dsh-quote-followup-version`. Bump both together.
7. **Codec ownership.** The quote codec source (`QUOTE_TRIGGER_SOURCE`) owns quote chips but
   deliberately returns **no `@` candidates** (`candidates: () => Promise.resolve([])`).
   Keep it that way.

## Testing policy

- Run `npm test` before every commit; it must pass.
- The harness runs `lib/client.js` against a fake DOM/window/editor, so it catches
  integration regressions (native chips, repeated quoting, draft spacing, codec
  serialization, Firefox fallback, stale singleton/button takeover) without starting `dsh web`.
- If you change the client entry (`lib/client.js`) or the version, re-run the harness and
  manually verify in a live `dsh web`: restart `dsh web`, then reload/reopen tabs that were
  open across the restart — already-loaded JS cannot update itself from a new server process.

## Making a change

1. Read `ARCHITECTURE.md` first; the integration paths are non-obvious.
2. Edit `lib/client.js` (or `cordis.patch.yml`, READMEs, harness) as needed.
3. If the external contract/version changed, bump `version` in `package.json` **and**
   `CLIENT_VERSION` in `lib/client.js`.
4. Run `npm test`.
5. Commit with a Conventional Commit (`feat(web):`, `fix(web):`, `refactor(web):`, …).
