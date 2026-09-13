# Assembled DSH Web regression

This opt-in suite loads the plugin through the real DSH Loader and browser module graph. It uses Chromium, the real composer and reference codec, and isolated synthetic sessions. The DSH test scaffold owns temporary storage, the Web listener, and shutdown.

## Reproduce

Use Node.js 24 and a built [DeepSeek Harness checkout at c291e7961a515f6d7af9304e7fd1d257929aef26](https://github.com/deepseek-ai/deepseek-harness/commit/c291e7961a515f6d7af9304e7fd1d257929aef26). In that checkout run `corepack pnpm install --frozen-lockfile`, `corepack pnpm run build`, and `corepack pnpm exec playwright install chromium` as needed for the local environment. Keep its tracked working tree clean.

From this plugin checkout:

```sh
npm test
npm run test:assembled-web -- --dsh-root <built-dsh-checkout>
```

The runner checks the baseline revision, creates a uniquely named scenario beneath DSH's Web test discovery directory, runs its existing Vitest Web configuration, and removes the generated scenario after the child process closes. The plugin is mounted from this checkout's Host entry and package metadata. DSH loads the published client entry through its browser module graph.

## Assertions

- Existing text survives two native quote insertions; undo changes the document and redo restores the complete quoted draft. Undo grouping follows the editor's native history policy.
- A second session receives its own draft; returning to the first session restores the correct text and quoted content.
- The real client prompt request contains the question and expanded Markdown quote for the selected session. The test intercepts and aborts that request at the browser boundary, keeping model traffic call-free.
- A Host-driven unavailable model route makes the real composer non-editable; attempting to quote leaves the draft unchanged. The test restores the previous Host setting in a finally block.

The baseline is for plugin v0.2.6 at the pinned DSH revision. A new DSH revision requires a deliberate compatibility run and a baseline update. Further integration cases can extend this foundation with asynchronous input adjudication and candidate public insertion APIs.

The existing zero-dependency `npm test` remains the fast fake-DOM suite. This separate lane uses the DSH checkout's test dependencies and built artifacts.

## Contribution provenance

The assembled-Web regression is contributed by foo-hao. Fixture construction follows DeepSeek Harness's MIT-licensed Web test patterns. The integration license retains both copyright notices; the plugin's existing license remains in place.
