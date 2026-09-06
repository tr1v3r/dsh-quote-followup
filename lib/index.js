/**
 * dsh-quote-followup — host half (TUI face).
 *
 * Quote selected conversation content into a targeted follow-up turn,
 * using only public, activation-gated seams (no Component admission, no
 * grants file, no TUI patches):
 *
 * - `session/event` (the ecosystem template's sanctioned firehose) buffers
 *   user/assistant messages per session id.
 * - `ctx.tuiShortcuts.register` binds Ctrl+Alt+Q; `ctx.tuiDialogs.select`
 *   lists recent messages (newest first, single pick, repeatable).
 * - The per-session injection socket (`~/.dsh-tui/inject/<sessionId>.sock`,
 *   the dsh.nvim contract) appends the quote block into the live prompt
 *   input — visible and editable before sending, exactly like the Web face.
 * - `ctx.tuiToast` reports outcomes.
 *
 * On profiles without the TUI seams (dsh web) this row is inert: the browser
 * half in ./client.js implements the Web face there.
 *
 * Known edge: the picker targets the session that received the most recent
 * user message; right after `/resume` (before the first new message) it may
 * briefly show the previous session's buffer. Documented, harmless.
 *
 * @module dsh-quote-followup
 */
import { createConnection } from 'node:net';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Stable Cordis plugin name (row id lives in cordis.patch.yml). */
export const name = 'quote-followup';
/** Services are resolved lazily via ctx.get so a bare mount degrades softly. */
export const inject = [];

/** Default global combo (ctrl/alt mandatory; ctrl+q is the todo-fold action). */
const DEFAULT_SHORTCUT = 'ctrl+alt+q';
/** Messages kept per session (session/event has no replay; live only). */
const BUFFER_PER_SESSION = 200;
/** Picker rows shown (newest first). */
const DEFAULT_PICKER_LIMIT = 30;
/** Per-quote character cap before truncation marker. */
const DEFAULT_QUOTE_MAX_CHARS = 1600;
/** Dialog auto-cancel bound (guards a wedged flow on headless embedders). */
const PICKER_TIMEOUT_MS = 180000;
/** How long to wait for sibling TUI services before going inert (ms). */
const SERVICE_WAIT_MS = 3000;
/** Picker row id for the clipboard quote (dsh-TUI copies mouse selections to
 *  the clipboard automatically — copy-on-select — so the freshest mouse
 *  selection is always quotable through this row). */
const CLIPBOARD_ROW_ID = '__clipboard__';
/** Injection-channel discovery file (see dsh-tui's inject-channel module). */
const INJECT_SERVERS_FILE = join(homedir(), '.dsh-tui', 'inject', 'servers.json');

/** One quoted message. */
/** @typedef {{seq: number, role: 'user'|'assistant', text: string}} QuoteEntry */

/** Clip a string to `max` cells with an ellipsis marker. Exported for tests. */
export function clip(text, max) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1))}…`;
}

/** Join the text blocks of an MCP content array. */
function textOfContent(content) {
    if (!Array.isArray(content))
        return '';
    return content
        .filter(block => block !== null && typeof block === 'object' && block.type === 'text')
        .map(block => String(block.text ?? ''))
        .join('\n')
        .trim();
}

/**
 * Project one `session/event` record onto a bufferable message.
 * Returns null for anything that is not a user/assistant text message.
 * Exported for tests.
 */
export function extractMessage(session, event) {
    if (event === null || typeof event !== 'object')
        return null;
    const type = event.type;
    if (type !== 'user/message' && type !== 'assistant/message')
        return null;
    const id = session !== null && typeof session === 'object' && typeof session.id === 'string' ? session.id : null;
    if (id === null)
        return null;
    const data = event.data;
    const record = data !== null && typeof data === 'object' ? data : {};
    const message = type === 'assistant/message' && record.message !== null && typeof record.message === 'object'
        ? record.message
        : record;
    const text = textOfContent(message.content);
    if (text === '')
        return null;
    return {
        sessionId: id,
        seq: typeof event.seq === 'number' ? event.seq : -1,
        role: type === 'user/message' ? 'user' : 'assistant',
        text,
    };
}

/** Quote lines as a markdown blockquote, capped at `quoteMaxChars`. */
function quoteBlock(entry, index, total, quoteMaxChars) {
    let body = entry.text;
    let truncated = false;
    if (body.length > quoteMaxChars) {
        body = body.slice(0, quoteMaxChars);
        truncated = true;
    }
    const tail = entry.seq === null || entry.seq === undefined ? '' : `#${entry.seq}`;
    const header = `> [引用 ${index}/${total} · ${entry.role}${tail}${truncated ? '，已截断' : ''}]`;
    const lines = body.split('\n').map(line => `> ${line}`.trimEnd());
    return `${header}\n${lines.join('\n')}`;
}

/**
 * Compose the quote block appended into the prompt input. Exported for tests.
 */
export function frameQuotes(quotes, quoteMaxChars = DEFAULT_QUOTE_MAX_CHARS) {
    const blocks = quotes.map((entry, i) => quoteBlock(entry, i + 1, quotes.length, quoteMaxChars));
    return `\n${blocks.join('\n\n')}\n\n`;
}

/** Read the injection-channel discovery file; [] when absent/unreadable. */
function readInjectServers() {
    try {
        const parsed = JSON.parse(readFileSync(INJECT_SERVERS_FILE, 'utf8'));
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter(entry => entry !== null && typeof entry === 'object'
            && typeof entry.pid === 'number' && typeof entry.socketPath === 'string');
    }
    catch {
        return [];
    }
}

/** One-shot line write to a local injection socket; resolves true on delivery. */
function injectAppend(socketPath, text) {
    return new Promise(resolve => {
        let socket;
        let settled = false;
        const finish = (ok) => {
            if (settled)
                return;
            settled = true;
            socket?.destroy();
            resolve(ok);
        };
        try {
            socket = createConnection(socketPath, () => {
                try {
                    socket.write(`${JSON.stringify({ type: 'prompt.append', text })}\n`);
                    socket.end();
                    finish(true);
                }
                catch {
                    finish(false);
                }
            });
            socket.on('error', () => finish(false));
            setTimeout(() => finish(false), 1500).unref?.();
        }
        catch {
            finish(false);
        }
    });
}

/**
 * Read the system clipboard. dsh-TUI's copy-on-select already places every
 * mouse selection there, so this is the bridge between terminal text
 * selection and the quote picker. `overrideCommand` (row config
 * `clipboardReadCommand`) runs via /bin/sh — mainly a deterministic seam
 * for tests and exotic setups. Resolves '' on any failure.
 */
export function readClipboard(overrideCommand) {
    const run = (file, args) => new Promise(resolve => {
        try {
            execFile(file, args, { timeout: 1200, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
                resolve(error === null ? String(stdout ?? '') : '');
            });
        }
        catch {
            resolve('');
        }
    });
    return (async () => {
        if (typeof overrideCommand === 'string' && overrideCommand.trim() !== '')
            return run('/bin/sh', ['-c', overrideCommand]);
        if (process.platform === 'darwin')
            return run('pbpaste', []);
        if (process.platform === 'linux') {
            for (const probe of [['wl-paste', []], ['xclip', ['-selection', 'clipboard', '-o']], ['xsel', ['--clipboard', '--output']]]) {
                const text = await run(probe[0], probe[1]);
                if (text !== '')
                    return text;
            }
        }
        return '';
    })();
}

/**
 * Apply: wire the TUI face when (and only when) the TUI extension seams are
 * mounted. Every registration is scoped with ctx.effect so a profile that
 * drops this row leaves nothing behind.
 */
export function apply(ctx, config) {
    const shortcut = typeof config?.shortcut === 'string' && config.shortcut.trim() !== ''
        ? config.shortcut.trim()
        : DEFAULT_SHORTCUT;
    const pickerLimit = Number.isInteger(config?.pickerLimit) && config.pickerLimit > 0
        ? config.pickerLimit
        : DEFAULT_PICKER_LIMIT;
    const quoteMaxChars = Number.isInteger(config?.quoteMaxChars) && config.quoteMaxChars > 0
        ? config.quoteMaxChars
        : DEFAULT_QUOTE_MAX_CHARS;
    const clipboardCommand = typeof config?.clipboardReadCommand === 'string'
        ? config.clipboardReadCommand
        : undefined;

    /** Per-session ring buffer of observed messages. */
    const buffers = new Map();
    /** Session the picker targets: the one with the latest user message. */
    let currentSessionId = null;
    let wired = false;
    /** Disposers accumulated by wire(); drained by the keep-alive effect. */
    const disposers = [];
    const keep = (dispose) => {
        if (typeof dispose === 'function' || typeof dispose === 'boolean')
            disposers.push(dispose);
    };

    const bufferOf = (sessionId) => {
        let list = buffers.get(sessionId);
        if (list === undefined) {
            list = [];
            buffers.set(sessionId, list);
        }
        return list;
    };
    const toast = (text) => {
        try {
            ctx.get('tuiToast')?.show(text);
        }
        catch {
            /* toast-less hosts: the dialog/keyboard flow still works */
        }
    };

    const onSessionEvent = (session, event) => {
        try {
            const message = extractMessage(session, event);
            if (message === null)
                return;
            const list = bufferOf(message.sessionId);
            list.push({ seq: message.seq, role: message.role, text: message.text });
            if (list.length > BUFFER_PER_SESSION)
                list.splice(0, list.length - BUFFER_PER_SESSION);
            if (message.role === 'user')
                currentSessionId = message.sessionId;
        }
        catch (error) {
            ctx.logger.warn(`dsh-quote-followup: session event dropped: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const onSessionDisposed = (session) => {
        const id = session !== null && typeof session === 'object' && typeof session.id === 'string' ? session.id : null;
        if (id !== null)
            buffers.delete(id);
    };

    /** Ctrl+Alt+Q → picker; each pick appends one quote block to the input. */
    const openPicker = async () => {
        const dialogs = ctx.get('tuiDialogs');
        if (dialogs === undefined) {
            toast('对话框服务不可用（需要 dsh-TUI 扩展行）');
            return;
        }
        let list = [];
        if (currentSessionId !== null)
            list = buffers.get(currentSessionId) ?? [];
        // dsh-TUI copies every mouse selection to the clipboard (copy-on-select,
        // then clears the highlight), so the clipboard holds exactly what the
        // user just selected. Offer it as the FIRST picker row.
        const clipboardText = await readClipboard(clipboardCommand);
        const options = [];
        if (clipboardText.trim() !== '') {
            options.push({
                id: CLIPBOARD_ROW_ID,
                label: `📋 划选/剪贴板 · ${clip(clipboardText, 40)}`,
                description: clip(clipboardText, 160),
            });
        }
        options.push(...list.slice(-pickerLimit).reverse().map(message => ({
            id: String(message.seq),
            label: `#${message.seq} ${message.role === 'user' ? '我' : '助手'} · ${clip(message.text, 44)}`,
            description: clip(message.text, 160),
        })));
        if (options.length === 0) {
            toast('没有可引用内容：划选一段文本（自动复制）或先对话后重试');
            return;
        }
        const title = '选择要引用的对话内容（可多次引用，Esc 取消）';
        let picked;
        try {
            picked = await dialogs.select({ title, options, timeoutMs: PICKER_TIMEOUT_MS });
        }
        catch {
            return;
        }
        if (picked === undefined)
            return;
        const entry = picked === CLIPBOARD_ROW_ID
            ? { seq: null, role: '划选', text: clipboardText }
            : list.find(message => String(message.seq) === picked);
        if (entry === undefined)
            return;
        const record = readInjectServers().find(server => server.pid === process.pid);
        if (record === undefined) {
            toast('注入通道不可用（~/.dsh-tui/inject/ 无本进程套接字）');
            return;
        }
        const delivered = await injectAppend(record.socketPath, frameQuotes([entry], quoteMaxChars));
        toast(delivered
            ? entry.seq === null
                ? '已引用划选内容 → 输入框（可继续追加，编辑后发送）'
                : `已引用 #${entry.seq} → 输入框（可继续 ${shortcut} 追加，编辑后发送）`
            : '引用写入输入框失败');
    };

    const wire = async () => {
        if (wired)
            return;
        wired = true;
        // Sibling rows ahead of us mount these during the same boot pass; a
        // short poll keeps an out-of-order embedder from silently disabling
        // the feature, while a headless/web host exits fast and inert.
        const deadline = Date.now() + SERVICE_WAIT_MS;
        let shortcuts = ctx.get('tuiShortcuts');
        while ((shortcuts === undefined || ctx.get('tuiDialogs') === undefined) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
            shortcuts = ctx.get('tuiShortcuts');
        }
        if (shortcuts === undefined) {
            ctx.logger.info('dsh-quote-followup: no dsh-TUI extension seams on this profile — row stays inert (web face lives in the browser half)');
            return;
        }
        keep(ctx.on('session/event', onSessionEvent));
        keep(ctx.on('session/disposed', onSessionDisposed));
        keep(shortcuts.register(shortcut, {
            description: '引用对话内容，针对性追问 (dsh-quote-followup)',
            handler: () => {
                void openPicker();
            },
        }, ctx));
        ctx.logger.info(`dsh-quote-followup: TUI face armed — ${shortcut} opens the quote picker`);
    };
    // The keep-alive effect is registered SYNCHRONOUSLY so the row's fiber
    // outlives apply(): wire() registers the shortcut after an await, and an
    // activation-scoped registration against an already-settled fiber is
    // released immediately (observed: register() succeeds, dispatch never
    // matches). This effect's disposer drains everything wire() accumulated.
    ctx.effect(() => () => {
        for (const dispose of disposers.splice(0)) {
            try {
                if (typeof dispose === 'function')
                    dispose();
            }
            catch {
                /* idempotent disposers; a double release is fine */
            }
        }
    });
    void wire();
}
