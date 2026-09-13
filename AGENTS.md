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
| `test/run-assembled-web.mjs` | Opt-in runner for the assembled DSH Web regression. It verifies the DSH checkout is at the pinned revision with a clean tracked tree, copies the scenario into a temporary dir under that checkout, and runs DSH's own Vitest+Playwright config. |
| `test/integration/` | Assembled-Web regression assets: the Playwright scenario (`assembled-web.ts`), its reproduce guide (`README.md`), and a scoped MIT `LICENSE` for fixtures adapted from DSH's MIT-licensed Web tests. Not published to npm. |
| `package.json` | Package metadata, `dsh` wiring, `npm test`, publishes `/lib` + `cordis.patch.yml`. |
| `screenshots.json` | **Not part of the npm package.** Declares the storefront screenshot(s) for [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin); paths are relative to this file and follow the default branch, so replacing the asset refreshes the listing without an upstream PR. |
| `docs/assets/quote-followup-demo.gif` | Demo asset referenced by `screenshots.json` and the READMEs. |
| `README.md`, `README.zh.md` | User-facing docs. Keep in sync with each other. |
| `ARCHITECTURE.md` | Deep-dive on the runtime architecture, integration and fallback paths. |

## Commands

```bash
npm test            # node --check lib/index.js && node --check lib/client.js && node test/web-repeat-harness.mjs
node --check lib/client.js   # quick syntax check
npm run test:assembled-web -- --dsh-root <built-dsh-checkout>   # opt-in assembled lane (pinned DSH revision, Chromium)
git status          # confirm only intended files changed
```

There is **no build step**. `lib/client.js` is the shipped source; do not introduce
Transpile/Bundler output into the repo. The hand-written TypeScript scenario under
`test/integration/` is not a violation: it is source executed by DSH's own Vitest inside
the consumer checkout, never transpiled in this repo, and `test/` is not published.

## Non-negotiable invariants

1. **No framework.** `lib/client.js` is pure DOM and carries no React/Lexical runtime.
   Its module-level export is `inject: ["inputTriggers", "locale"]` plus an `apply(ctx)`
   function. Both services are optional: when `locale` is absent the module falls back to
   English copy, and when `inputTriggers` is absent it degrades to the text fallback.
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
7. **Codec ownership.** The quote codec source (`QUOTE_SOURCE`) owns quote chips but
   deliberately returns **no `@` candidates** (`candidates: () => Promise.resolve([])`).
   Keep it that way. The codec must degrade gracefully: a malformed chip `ref` resolves to
   an empty projection instead of throwing.

## Testing policy

- Run `npm test` before every commit; it must pass.
- The harness runs `lib/client.js` against a fake DOM/window/editor, so it catches
  integration regressions (native chips, repeated quoting, draft spacing, codec
  serialization, Firefox fallback, stale singleton/button takeover) without starting `dsh web`.
- The assembled DSH Web lane (`test:assembled-web`) is **opt-in and not a pre-commit gate**.
  It needs a built deepseek-harness checkout at the pinned revision with a clean tracked
  tree (see `test/integration/README.md`); a new DSH revision requires a deliberate
  compatibility run before updating the pin. The scenario TS has no repo-side syntax/type
  check — it is validated only inside that checkout.
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
