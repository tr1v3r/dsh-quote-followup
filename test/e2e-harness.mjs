/**
 * Headless E2E harness for the dsh-quote-followup TUI face (public-seam
 * architecture): extensions row (shortcuts/dialogs/toast) + our plugin row.
 * Drives: fake session/event firehose → Ctrl+Alt+Q → intercepted dialog pick
 * → real injection-socket round-trip (local net server + discovery file).
 * Run: node /tmp/qf-harness.mjs
 */
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROFILE = process.env.QF_TUI_PROFILE ?? `${process.env.HOME}/.config/dsh/profiles/dsh-tui`;
const TUI = `${PROFILE}/node_modules/@deepseek-harness-tui/dsh-tui/lib/types`;
const CORDIS = process.env.QF_CORDIS ?? `${process.env.HOME}/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js`;
const SERVERS_FILE = join(process.env.HOME, '.dsh-tui', 'inject', 'servers.json');

const { Context } = await import(`file://${CORDIS}`);
const extensionsModule = await import(`file://${TUI}/dsh-adapter/extensions.js`);
const shortcutsModule = await import(`file://${TUI}/dsh-adapter/shortcuts.js`);
const { getHostShortcuts } = shortcutsModule;
const plugin = await import(new URL('../lib/index.js', import.meta.url).href);

const log = (...args) => console.log('[harness]', ...args);
let failures = 0;
const check = (name, ok, detail) => {
    if (ok) log('PASS:', name, detail ?? '');
    else { failures += 1; console.error('[harness] FAIL:', name, detail ?? ''); }
};

// ── pure unit checks ─────────────────────────────────────────────────────
const extracted = plugin.extractMessage({ id: 's1' }, {
    type: 'user/message', seq: 3, data: { content: [{ type: 'text', text: '帮我看下\n这段配置' }] },
});
check('extract user/message', extracted !== null && extracted.role === 'user' && extracted.seq === 3
    && extracted.text.includes('这段配置'), JSON.stringify(extracted));
const extractedA = plugin.extractMessage({ id: 's1' }, {
    type: 'assistant/message', seq: 5, data: { message: { content: [{ type: 'text', text: '回答' }] } },
});
check('extract assistant/message (nested)', extractedA !== null && extractedA.role === 'assistant' && extractedA.text === '回答');
check('extract ignores tool events', plugin.extractMessage({ id: 's1' }, { type: 'tool/call', seq: 9, data: {} }) === null);
check('extract requires session id', plugin.extractMessage(null, { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'x' }] } }) === null);
const framed = plugin.frameQuotes([{ seq: 5, role: 'assistant', text: '第一行\n第二行' }]);
check('frame shape', framed.startsWith('\n> [引用 1/1 · assistant#5]') && framed.includes('> 第一行') && framed.endsWith('\n\n'), JSON.stringify(framed));
const framedLong = plugin.frameQuotes([{ seq: 7, role: 'user', text: 'x'.repeat(3000) }], 1600);
check('frame truncation marker', framedLong.includes('，已截断]') && framedLong.length < 1800);

// ── live wiring with a real injection socket ─────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'qf-inject-'));
const sockPath = join(dir, 'test.sock');
const received = [];
const server = createServer(socket => {
    socket.setEncoding('utf8');
    socket.on('data', chunk => received.push(chunk));
});
await new Promise(resolve => server.listen(sockPath, resolve));
const backup = existsSync(SERVERS_FILE) ? readFileSync(SERVERS_FILE, 'utf8') : null;
writeFileSync(SERVERS_FILE, JSON.stringify([{ pid: process.pid, sessionId: 'harness', cwd: dir, socketPath: sockPath, startedAt: Date.now() }]));

try {
    const clipboardFixture = join(dir, 'clip.txt');
    writeFileSync(clipboardFixture, '这是刚划选的终端文本');
    const root = new Context({});
    await root.plugin(extensionsModule.default ?? extensionsModule);
    root.plugin({ name: 'dsh-quote-followup', apply: ctx => plugin.apply(ctx, { clipboardReadCommand: `cat ${clipboardFixture}` }) });
    await new Promise(resolve => setTimeout(resolve, 3400)); // service-wait budget

    const shortcuts = root.get('tuiShortcuts');
    const dialogs = root.get('tuiDialogs');
    check('services mounted', shortcuts !== undefined && dialogs !== undefined);

    let lastOptions = [];
    let pickId = null;
    dialogs.select = async request => {
        lastOptions = request.options;
        return pickId === null ? undefined : request.options.find(option => option.id === pickId)?.id;
    };

    // firehose: two messages in session s1, one in s2 (must not leak)
    root.emit('session/event', { id: 's1' }, { type: 'user/message', seq: 3, data: { content: [{ type: 'text', text: '帮我看下这段配置' }] } });
    root.emit('session/event', { id: 's1' }, { type: 'assistant/message', seq: 5, data: { message: { content: [{ type: 'text', text: '这是助手的回答内容' }] } } });
    root.emit('session/event', { id: 's2' }, { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '另一个会话' }] } });
    await new Promise(resolve => setTimeout(resolve, 200));

    // s2 has the LATEST user message → picker targets s2 (documented semantics).
    // The clipboard row (copy-on-select bridge) always leads the list.
    pickId = '__clipboard__';
    const matched = getHostShortcuts(shortcuts).dispatch('q', { ctrl: true, meta: true, shift: false, super: false });
    check('shortcut dispatched', matched === true);
    await new Promise(resolve => setTimeout(resolve, 400));
    check('clipboard row leads the picker', lastOptions[0]?.id === '__clipboard__' && lastOptions.length === 2
        && lastOptions[1].id === '1', lastOptions.map(o => o.label).join(' | '));
    let payload = received.join('');
    let injectLine = null;
    try {
        injectLine = JSON.parse(payload.trim().split('\n').pop());
    }
    catch { /* assertion below */ }
    check('clipboard quote injected', injectLine !== null && injectLine.type === 'prompt.append'
        && injectLine.text.includes('[引用 1/1 · 划选]') && injectLine.text.includes('这是刚划选的终端文本'),
        payload.slice(0, 160));

    // now make s1 current (latest user message) and pick the assistant answer
    pickId = '5';
    root.emit('session/event', { id: 's1' }, { type: 'user/message', seq: 8, data: { content: [{ type: 'text', text: '再问一句' }] } });
    await new Promise(resolve => setTimeout(resolve, 100));
    getHostShortcuts(shortcuts).dispatch('q', { ctrl: true, meta: true, shift: false, super: false });
    await new Promise(resolve => setTimeout(resolve, 600));

    check('picker listed s1 messages', lastOptions.some(o => o.id === '8') && lastOptions.some(o => o.id === '5'),
        lastOptions.map(o => o.label).join(' | '));
    payload = received.join('');
    injectLine = null;
    try {
        injectLine = JSON.parse(payload.trim().split('\n').pop());
    }
    catch { /* assertion below */ }
    check('inject socket got prompt.append', injectLine !== null && injectLine.type === 'prompt.append'
        && injectLine.text.includes('[引用 1/1 · assistant#5]') && injectLine.text.includes('这是助手的回答内容'),
        payload.slice(0, 160));

    // disposal cleanup
    root.emit('session/disposed', { id: 's1' });
    await root.fiber.dispose();
    log('disposed cleanly');
}
finally {
    if (backup === null) {
        try { unlinkSync(SERVERS_FILE); } catch { }
    }
    else writeFileSync(SERVERS_FILE, backup);
    server.close();
}

console.log(failures === 0 ? '[harness] ALL PASS' : `[harness] ${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
