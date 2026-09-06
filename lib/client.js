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
		/** Per-quote character cap, mirroring the TUI face. */
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
		/** Markdown blockquote frame for one quoted fragment. */
		const quoteFrame = (text, role) => {
			let body = String(text ?? "");
			let truncated = false;
			if (body.length > QUOTE_MAX_CHARS) {
				body = body.slice(0, QUOTE_MAX_CHARS);
				truncated = true;
			}
			const who = role === "user" ? "user" : role === "assistant" ? "assistant" : "对话";
			const lines = body.split("\n").map((line) => `> ${line}`.trimEnd());
			return `> [引用 · ${who}${truncated ? "，已截断" : ""}]\n${lines.join("\n")}\n\n`;
		};
		const findComposer = () => {
			for (const selector of COMPOSER_SELECTORS) {
				const element = document.querySelector(selector);
				if (element !== null)
					return element;
			}
			return null;
		};
		/** Dispatch a real paste path so stateful editors (Lexical) own the update. */
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
			range.selectNodeContents(element);
			range.collapse(false);
			selection?.removeAllRanges();
			selection?.addRange(range);
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
		const ensureButton = () => {
			const existing = document.getElementById(BUTTON_ID);
			if (existing !== null)
				return existing;
			const button = document.createElement("button");
			button.id = BUTTON_ID;
			button.type = "button";
			button.textContent = "❐ 引用";
			button.title = "引用选中内容到输入框（可多次引用，发送前可编辑）";
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
			pendingQuote = { text: text.trim(), role: detectRole(selection.getRangeAt(0), transcript) };
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
			appendToComposer(composer, quoteFrame(quote.text, quote.role));
		};
		//#endregion
		//#region apply
		const MOUNTED = Symbol.for("dsh-quote-followup.mounted");
		function apply(ctx) {
			if (globalThis[MOUNTED] === true)
				return;
			globalThis[MOUNTED] = true;
			const onScroll = () => hideButton();
			const onKeyDown = (event) => {
				if (event.key === "Escape")
					hideButton();
			};
			const onMouseDown = (event) => {
				if (event.target instanceof Element && event.target.id !== BUTTON_ID)
					hideButton();
			};
			document.addEventListener("selectionchange", onSelectionChange);
			window.addEventListener("scroll", onScroll, true);
			document.addEventListener("keydown", onKeyDown, true);
			document.addEventListener("mousedown", onMouseDown, true);
			const cleanup = () => {
				globalThis[MOUNTED] = false;
				document.removeEventListener("selectionchange", onSelectionChange);
				window.removeEventListener("scroll", onScroll, true);
				document.removeEventListener("keydown", onKeyDown, true);
				document.removeEventListener("mousedown", onMouseDown, true);
				hideButton();
				document.getElementById(BUTTON_ID)?.remove();
			};
			if (ctx !== undefined && typeof ctx.effect === "function")
				ctx.effect(() => cleanup, "dsh-quote-followup: selection quote ui");
		}
		//#endregion
		exports.inject = [];
		exports.apply = apply;
		return module.exports;
	}
});
