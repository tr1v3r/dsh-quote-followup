/**
 * dsh-quote-followup — browser half (Web face).
 *
 * Select text anywhere inside the conversation transcript
 * (`[data-slot="conversation.session"]`), click the floating ❐ 引用 button,
 * and the selection lands in the composer as a markdown blockquote the user
 * can edit before sending — a visible, targeted follow-up with zero hidden
 * state and zero host-side privileges.
 *
 * Pure DOM (no React), so the module carries no platform dependencies:
 * `inject: []`. Mounted by the web client runtime through the package's
 * `dsh.client` declaration (`platform: "web"`).
 *
 * @module dsh-quote-followup/client
 */
window.__ModuleLoader__.load({
	id: "dsh-quote-followup",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region constants
		/** Official slot wrapper owning the chat transcript (composer excluded). */
		const TRANSCRIPT_SELECTOR = '[data-slot="conversation.session"]';
		/** Composer input candidates, most specific first (official slot → legacy hints). */
		const COMPOSER_SELECTORS = [
			'[data-slot="conversation.composer"] textarea',
			'[data-slot="conversation.composer"] [contenteditable="true"]',
			'textarea[data-phase]',
			'[data-composer-card] textarea',
			'[data-composer-card] [contenteditable="true"]',
			'[data-input-scroll] textarea'
		];
		const BUTTON_ID = "dsh-quote-followup-btn";
		const BUTTON_VERSION_ATTR = "data-dsh-quote-followup-version";
		const CLIENT_VERSION = "0.2.5";
		/** Codec owner for native DSH reference chips. */
		const QUOTE_SOURCE = "quote-followup";
		const LOCALE_NS = "quote-followup";
		/** UI + serialized frame copy; the active DSH locale picks the language. */
		const LOCALE_DICT = {
			zh: {
				"button.label": "❐ 引用",
				"button.title": "引用选中内容到输入框（可多次引用，发送前可编辑）",
				"quote.header": "引用",
				"conversation.role": "对话",
				"quote.turn": "第 {n} 轮",
				"quote.truncated": "已截断"
			},
			en: {
				"button.label": "❐ Quote",
				"button.title": "Quote the selection into the composer (repeatable; editable before sending)",
				"quote.header": "Quote",
				"conversation.role": "conversation",
				"quote.turn": "turn {n}",
				"quote.truncated": "truncated"
			}
		};
		const fallbackT = (key) => LOCALE_DICT.en[key] ?? key;
		/** Per-quote character cap for a bounded composer insertion. */
		const QUOTE_MAX_CHARS = 1600;
		//#endregion
		//#region helpers
		const elementOf = (node) => (node === null ? null : node.nodeType === 1 ? node : node.parentElement);
		const transcriptOf = (node) => {
			const element = elementOf(node);
			return element === null ? null : element.closest(TRANSCRIPT_SELECTOR);
		};
		/** The live selection when BOTH ends sit inside the same transcript. */
		const selectionInTranscript = (selection) => {
			if (selection === null || selection.isCollapsed || selection.rangeCount === 0)
				return null;
			const anchor = transcriptOf(selection.anchorNode);
			const focus = transcriptOf(selection.focusNode);
			if (anchor === null || anchor !== focus)
				return null;
			return anchor;
		};
		/**
		 * Best-effort role for the quoted fragment: walk up from the range start
		 * looking for role markers (data attributes, then class-name hints).
		 * Null → the generic "对话" label; this is display-only metadata.
		 */
		const detectRole = (range, transcript) => {
			let element = elementOf(range.startContainer);
			while (element !== null && element !== transcript) {
				const role = element.getAttribute?.("data-role") ?? element.getAttribute?.("data-message-role");
				if (typeof role === "string" && role !== "") {
					if (/user|human/i.test(role)) return "user";
					if (/assistant|model|ai\b/i.test(role)) return "assistant";
				}
				const cls = String(element.className ?? "");
				if (/(^|[\s_-])user([\s_-]|$)/i.test(cls)) return "user";
				if (/(^|[\s_-])assistant([\s_-]|$)/i.test(cls)) return "assistant";
				element = element.parentElement;
			}
			return null;
		};
		const roleLabel = (role, t) => role === "user" ? "user" : role === "assistant" ? "assistant" : t("conversation.role");
		/**
		 * Conversation-turn provenance: DSH's chat renderer stamps every message
		 * row with `data-chat-turn` (a per-session monotonic ordinal). Resolving
		 * it lets the model address "what you quoted in turn N" without any
		 * host-side message-id API. Absent / non-numeric markers degrade to null
		 * and the serialized frame stays exactly as before.
		 */
		const detectTurn = (range, transcript) => {
			let element = elementOf(range.startContainer);
			while (element !== null && element !== transcript) {
				const raw = element.getAttribute?.("data-chat-turn");
				if (typeof raw === "string" && raw !== "") {
					const turn = Number(raw);
					if (Number.isSafeInteger(turn) && turn >= 0)
						return turn;
				}
				element = element.parentElement;
			}
			return null;
		};
		/** Bound one quote before it becomes editor state. */
		const quotePayload = (text, role, turn) => {
			let body = String(text ?? "");
			let truncated = false;
			if (body.length > QUOTE_MAX_CHARS) {
				body = body.slice(0, QUOTE_MAX_CHARS);
				truncated = true;
			}
			return { text: body, role, truncated, turn: Number.isSafeInteger(turn) && turn >= 0 ? turn : null };
		};
		/** Model / clipboard projection. The composer shows a chip, not this frame. */
		const quoteFrame = ({ text, role, truncated, turn }, t) => {
			const lines = text.split("\n").map((line) => `> ${line}`.trimEnd());
			const meta = [t("quote.header"), roleLabel(role, t)];
			if (Number.isSafeInteger(turn) && turn >= 0)
				meta.push(String(t("quote.turn")).replace("{n}", String(turn)));
			if (truncated)
				meta.push(t("quote.truncated"));
			return `> [${meta.join(" · ")}]\n${lines.join("\n")}\n\n`;
		};
		const decodeQuote = (ref) => {
			const value = JSON.parse(ref);
			if (value === null || typeof value !== "object" || typeof value.text !== "string")
				throw new Error("invalid quote-followup reference");
			return {
				text: value.text,
				role: value.role === "user" || value.role === "assistant" ? value.role : null,
				truncated: value.truncated === true,
				turn: Number.isSafeInteger(value.turn) && value.turn >= 0 ? value.turn : null
			};
		};
		const quoteInsert = (payload, t) => {
			const clipboardText = quoteFrame(payload, t);
			const preview = payload.text.replace(/\s+/g, " ").trim();
			return {
				source: QUOTE_SOURCE,
				ref: JSON.stringify(payload),
				// The bubble icon carries the quote meaning; keep only the excerpt
				// visible. Role/truncation stay in the serialized Markdown frame.
				label: preview,
				appearance: "session",
				clipboardText
			};
		};
		/** Codec-only source: it owns quote chips but intentionally adds no @ candidates. */
		const makeQuoteSource = (t) => ({
			trigger: "@",
			name: QUOTE_SOURCE,
			order: 1000,
			candidates: () => Promise.resolve([]),
			onPick: () => void 0,
			codec: {
				clipboardText: (ref) => quoteFrame(decodeQuote(ref), t),
				serialize: (ref) => Promise.resolve(quoteFrame(decodeQuote(ref), t))
			}
		});
		const findComposer = () => {
			for (const selector of COMPOSER_SELECTORS) {
				const element = document.querySelector(selector);
				if (element !== null)
					return element;
			}
			return null;
		};
		/**
		 * Insert through DSH's registered ReferenceChipNode so the quote uses the
		 * exact same atomic editor entity and visual treatment as @file/@session.
		 * The node class is already registered on the live composer; no second
		 * Lexical or React runtime is loaded by this plugin.
		 */
		const appendQuoteChip = (element, payload, t) => {
			const editor = element.__lexicalEditor;
			const registry = editor?._nodes;
			const ChipNode = registry?.get?.("reference-chip")?.klass;
			const TextNode = registry?.get?.("text")?.klass;
			const ParagraphNode = registry?.get?.("paragraph")?.klass;
			if (typeof editor?.update !== "function" || typeof ChipNode !== "function" || typeof TextNode !== "function" || typeof ParagraphNode !== "function")
				return false;
			try {
				let inserted = false;
				editor.update(() => {
					const state = editor._pendingEditorState ?? editor._editorState;
					const root = state?._nodeMap?.get?.("root");
					if (root === void 0 || root === null || typeof root.append !== "function")
						return;
					let block = typeof root.getLastChild === "function" ? root.getLastChild() : null;
					if (block === null || typeof block.append !== "function") {
						block = new ParagraphNode();
						root.append(block);
					}
					const nodes = [];
					const tail = typeof block.getTextContent === "function" ? block.getTextContent().slice(-1) : "";
					if (tail !== "" && !/\s/u.test(tail))
						nodes.push(new TextNode(" "));
					nodes.push(new ChipNode(quoteInsert(payload, t)));
					const trailing = new TextNode(" ");
					nodes.push(trailing);
					block.append(...nodes);
					if (typeof trailing.selectEnd === "function")
						trailing.selectEnd();
					inserted = true;
				}, { discrete: true });
				if (inserted)
					element.focus();
				return inserted;
			} catch (error) {
				console.warn("[dsh-quote-followup] native reference chip failed; using text fallback", error);
				return false;
			}
		};
		/**
		 * Use the live Lexical command table when DSH exposes its editor on the root.
		 * This bypasses browser security differences around synthetic clipboardData
		 * while still entering through DSH's own PASTE_COMMAND → keyboard.paste path.
		 */
		const pasteViaLexical = (element, text) => {
			const editor = element.__lexicalEditor;
			if (editor === null || typeof editor !== "object" || typeof editor.dispatchCommand !== "function")
				return false;
			const commands = editor._commands;
			if (commands === null || typeof commands !== "object" || typeof commands.keys !== "function")
				return false;
			const command = [...commands.keys()].find((candidate) => candidate?.type === "PASTE_COMMAND");
			if (command === undefined)
				return false;
			const clipboardData = {
				files: [],
				items: [],
				types: ["text/plain"],
				getData: (type) => type === "text/plain" ? text : ""
			};
			const event = {
				clipboardData,
				defaultPrevented: false,
				preventDefault() { this.defaultPrevented = true; },
				stopPropagation() {}
			};
			try {
				return editor.dispatchCommand(command, event) === true;
			} catch (error) {
				console.warn("[dsh-quote-followup] Lexical paste command failed; using DOM event fallback", error);
				return false;
			}
		};
		/** Dispatch a DOM paste fallback for non-DSH stateful editors. */
		const pasteIntoEditor = (element, text) => {
			let clipboardData = null;
			try {
				clipboardData = new DataTransfer();
				clipboardData.setData("text/plain", text);
			} catch {}
			let event;
			try {
				event = new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
					clipboardData
				});
			} catch {
				event = new Event("paste", { bubbles: true, cancelable: true });
			}
			if (clipboardData !== null && event.clipboardData == null) {
				try {
					Object.defineProperty(event, "clipboardData", { value: clipboardData });
				} catch {}
			}
			element.dispatchEvent(event);
			return event.defaultPrevented;
		};
		/**
		 * Append the quote at the END of the composer text (classic quote-reply
		 * reading order) and leave the caret on the blank line for the question.
		 * Textareas use their native setter; stateful contenteditables receive a
		 * paste event so Lexical/other editors update their model, not only the DOM.
		 */
		const appendToComposer = (element, insertText) => {
			element.focus();
			if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
				const value = element.value ?? "";
				const lead = value !== "" && !value.endsWith("\n") ? "\n" : "";
				const next = `${value}${lead}${insertText}`;
				const descriptor = element.tagName === "TEXTAREA"
					? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
					: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
				(descriptor?.set ?? ((v) => { element.value = v; })).call(element, next);
				element.dispatchEvent(new Event("input", { bubbles: true }));
				const caret = next.length;
				element.setSelectionRange(caret, caret);
				return;
			}
			const selection = document.getSelection();
			const range = document.createRange();
			// A Lexical root with existing block children does not admit a caret at
			// `root.childNodes.length`: its paste listener ignores that DOM point,
			// then mutation reconciliation deletes the raw-text fallback. Put the
			// caret INSIDE the last block instead. The empty-editor case still uses
			// the root because it has no block yet.
			const caretContainer = element.lastElementChild ?? element;
			range.selectNodeContents(caretContainer);
			range.collapse(false);
			selection?.removeAllRanges();
			selection?.addRange(range);
			if (pasteViaLexical(element, insertText))
				return;
			if (pasteIntoEditor(element, insertText))
				return;
			if (typeof document.execCommand === "function" && document.execCommand("insertText", false, insertText))
				return;
			range.insertNode(document.createTextNode(insertText));
			range.collapse(false);
			element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: insertText }));
		};
		//#endregion
		//#region floating button
		let pendingQuote = null;
		let quoteSourceReady = false;
		let currentT = fallbackT;
		const ensureButton = () => {
			const existing = document.getElementById(BUTTON_ID);
			if (existing?.getAttribute(BUTTON_VERSION_ATTR) === CLIENT_VERSION)
				return existing;
			existing?.remove();
			const button = document.createElement("button");
			button.id = BUTTON_ID;
			button.setAttribute(BUTTON_VERSION_ATTR, CLIENT_VERSION);
			button.type = "button";
			button.textContent = currentT("button.label");
			button.title = currentT("button.title");
			Object.assign(button.style, {
				position: "fixed",
				zIndex: "2147483600",
				padding: "3px 10px",
				fontSize: "12px",
				lineHeight: "20px",
				borderRadius: "6px",
				border: "1px solid rgba(140,140,150,.45)",
				background: "rgba(56,56,62,.94)",
				color: "#f5f5f7",
				cursor: "pointer",
				boxShadow: "0 2px 10px rgba(0,0,0,.28)",
				userSelect: "none",
				display: "none"
			});
			button.addEventListener("mousedown", (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				onQuoteClick();
			});
			document.body.appendChild(button);
			return button;
		};
		const placeButton = (button, rect) => {
			let x = rect.left + rect.width / 2 - 30;
			let y = rect.top - 28;
			if (y < 4)
				y = rect.bottom + 6;
			x = Math.max(4, Math.min(x, window.innerWidth - 70));
			button.style.left = `${Math.round(x)}px`;
			button.style.top = `${Math.round(y)}px`;
			button.style.display = "block";
		};
		const hideButton = () => {
			const button = document.getElementById(BUTTON_ID);
			if (button !== null)
				button.style.display = "none";
		};
		const onSelectionChange = () => {
			const selection = document.getSelection();
			const transcript = selectionInTranscript(selection);
			if (transcript === null) {
				pendingQuote = null;
				hideButton();
				return;
			}
			const text = selection.toString();
			if (text === null || text.trim() === "") {
				pendingQuote = null;
				hideButton();
				return;
			}
			const rect = selection.getRangeAt(0).getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) {
				hideButton();
				return;
			}
			pendingQuote = {
				text: text.trim(),
				role: detectRole(selection.getRangeAt(0), transcript),
				turn: detectTurn(selection.getRangeAt(0), transcript)
			};
			placeButton(ensureButton(), rect);
		};
		const onQuoteClick = () => {
			if (pendingQuote === null)
				return;
			const quote = pendingQuote;
			pendingQuote = null;
			hideButton();
			const composer = findComposer();
			if (composer === null) {
				console.warn("[dsh-quote-followup] composer input not found — quote dropped");
				return;
			}
			// Clear the transcript range BEFORE focusing the composer. Clearing after
			// insertion destroys Lexical's caret and makes the next quote unreliable.
			document.getSelection()?.removeAllRanges();
			const payload = quotePayload(quote.text, quote.role, quote.turn);
			if (!(quoteSourceReady && appendQuoteChip(composer, payload, currentT)))
				appendToComposer(composer, quoteFrame(payload, currentT));
		};
		//#endregion
		//#region apply
		const STATE = Symbol.for("dsh-quote-followup.state");
		function apply(ctx) {
			const previous = globalThis[STATE];
			if (previous?.version === CLIENT_VERSION)
				return;
			if (typeof previous?.dispose === "function")
				previous.dispose();
			let unregisterSource = null;
			let unregisterLocale = null;
			let unsubscribeLocale = null;
			const refreshButtonCopy = () => {
				const button = document.getElementById(BUTTON_ID);
				if (button !== null) {
					button.textContent = currentT("button.label");
					button.title = currentT("button.title");
				}
			};
			try {
				const locale = typeof ctx?.get === "function" ? ctx.get("locale") : null;
				if (typeof locale?.register === "function" && typeof locale?.bind === "function") {
					unregisterLocale = locale.register(LOCALE_NS, LOCALE_DICT);
					currentT = locale.bind(LOCALE_NS);
					if (typeof locale.subscribe === "function") {
						unsubscribeLocale = locale.subscribe(refreshButtonCopy);
					}
				} else {
					currentT = fallbackT;
				}
			} catch (error) {
				console.warn("[dsh-quote-followup] locale unavailable; using English copy", error);
				currentT = fallbackT;
			}
			try {
				const inputTriggers = typeof ctx?.get === "function" ? ctx.get("inputTriggers") : null;
				if (typeof inputTriggers?.registerSource === "function") {
					unregisterSource = inputTriggers.registerSource(makeQuoteSource(currentT));
					quoteSourceReady = true;
				}
			} catch (error) {
				console.warn("[dsh-quote-followup] native reference codec unavailable; using text fallback", error);
			}
			const onScroll = () => hideButton();
			const onKeyDown = (event) => {
				if (event.key === "Escape")
					hideButton();
			};
			const onMouseDown = (event) => {
				if (event.target instanceof Element && event.target.id !== BUTTON_ID)
					hideButton();
			};
			let disposed = false;
			let state;
			const cleanup = () => {
				if (disposed)
					return;
				disposed = true;
				quoteSourceReady = false;
				if (typeof unsubscribeLocale === "function")
					unsubscribeLocale();
				if (typeof unregisterLocale === "function")
					unregisterLocale();
				currentT = fallbackT;
				if (typeof unregisterSource === "function")
					unregisterSource();
				document.removeEventListener("selectionchange", onSelectionChange);
				window.removeEventListener("scroll", onScroll, true);
				document.removeEventListener("keydown", onKeyDown, true);
				document.removeEventListener("mousedown", onMouseDown, true);
				const button = document.getElementById(BUTTON_ID);
				if (button?.getAttribute(BUTTON_VERSION_ATTR) === CLIENT_VERSION)
					button.remove();
				if (globalThis[STATE] === state)
					delete globalThis[STATE];
			};
			state = { version: CLIENT_VERSION, dispose: cleanup };
			globalThis[STATE] = state;
			document.addEventListener("selectionchange", onSelectionChange);
			window.addEventListener("scroll", onScroll, true);
			document.addEventListener("keydown", onKeyDown, true);
			document.addEventListener("mousedown", onMouseDown, true);
			// Claim the shared id immediately so an older listener in a long-lived tab
			// cannot keep its obsolete click handler after a client hot-swap.
			ensureButton();
			if (ctx !== undefined && typeof ctx.effect === "function")
				ctx.effect(() => cleanup, "dsh-quote-followup: selection quote ui");
		}
		//#endregion
		exports.inject = ["inputTriggers", "locale"];
		exports.apply = apply;
		return module.exports;
	}
});
