import assert from "node:assert/strict";

let syntheticClipboardEnabled = true;

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
    this.clipboardData = init.clipboardData ?? null;
    this.defaultPrevented = false;
    this.key = init.key;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() {}
}

class FakeClipboardEvent extends FakeEvent {
  constructor(type, init = {}) {
    super(type, { ...init, clipboardData: syntheticClipboardEnabled ? init.clipboardData : null });
    if (!syntheticClipboardEnabled) {
      Object.defineProperty(this, "clipboardData", { value: null, configurable: false });
    }
  }
}

class FakeTarget {
  listeners = new Map();
  addEventListener(type, listener) {
    const rows = this.listeners.get(type) ?? [];
    rows.push(listener);
    this.listeners.set(type, rows);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((row) => row !== listener));
  }
  dispatchEvent(event) {
    event.target ??= this;
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return !event.defaultPrevented;
  }
}

class FakeElement extends FakeTarget {
  constructor(tagName, parentElement = null) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.parentElement = parentElement;
    this.lastElementChild = null;
    this.style = {};
    this.attributes = new Map();
    this.id = "";
    this.className = "";
    this.textContent = "";
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  closest(selector) {
    let cursor = this;
    while (cursor !== null) {
      if (selector === '[data-slot="conversation.session"]' && cursor.isTranscript) return cursor;
      cursor = cursor.parentElement;
    }
    return null;
  }
  focus() {}
  remove() { elementsById.delete(this.id); }
}

class FakeDataTransfer {
  #data = new Map();
  items = [];
  setData(type, value) { this.#data.set(type, String(value)); }
  getData(type) { return this.#data.get(type) ?? ""; }
}

const elementsById = new Map();
const transcript = new FakeElement("section");
transcript.isTranscript = true;
const startNode = { nodeType: 3, parentElement: transcript };
const composer = new FakeElement("div");
composer.setAttribute("contenteditable", "true");
let editorDraft = "";
let focusSawClearedTranscript = false;
let rawFallbackEnabled = true;

const selection = {
  isCollapsed: false,
  rangeCount: 1,
  anchorNode: startNode,
  focusNode: startNode,
  text: "",
  range: null,
  toString() { return this.text; },
  getRangeAt() { return this.range; },
  removeAllRanges() { this.rangeCount = 0; this.anchorNode = null; this.focusNode = null; this.range = null; },
  addRange(range) {
    this.rangeCount = 1;
    this.range = range;
    this.anchorNode = range.selectedNode;
    this.focusNode = range.selectedNode;
  }
};

composer.focus = () => {
  focusSawClearedTranscript = selection.rangeCount === 0;
};
composer.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (text === "") return;
  // Mirror the real Lexical boundary: an empty editor accepts a root caret,
  // but once a paragraph exists a caret AFTER that block is not a Lexical
  // RangeSelection, so the root paste listener ignores the event.
  if (editorDraft !== "" && selection.anchorNode === composer) return;
  event.preventDefault();
  editorDraft += text;
  composer.lastElementChild ??= new FakeElement("p", composer);
});

const makeTranscriptRange = () => ({
  startContainer: startNode,
  getBoundingClientRect: () => ({ left: 100, top: 100, bottom: 120, width: 80, height: 20 })
});
const makeComposerRange = () => ({
  selectedNode: null,
  selectNodeContents(node) { this.selectedNode = node; },
  collapse() {},
  insertNode(node) {
    // Lexical reconciliation may drop every raw DOM fallback (Firefox case),
    // and always drops a root-after-block insertion once content exists.
    if (rawFallbackEnabled && (editorDraft === "" || this.selectedNode !== composer)) editorDraft += node.textContent;
  }
});

const documentTarget = new FakeTarget();
const document = Object.assign(documentTarget, {
  body: {
    appendChild(element) {
      if (element.id !== "") elementsById.set(element.id, element);
    }
  },
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (text) => ({ textContent: text }),
  createRange: makeComposerRange,
  getElementById: (id) => elementsById.get(id) ?? null,
  getSelection: () => selection,
  querySelector: (selector) => selector.includes("contenteditable") ? composer : null
});

let clientModule;
const windowTarget = new FakeTarget();
const window = Object.assign(windowTarget, {
  innerWidth: 1200,
  __ModuleLoader__: {
    load(spec) { clientModule = spec.factory(() => { throw new Error("unexpected require"); }); }
  },
  getSelection: () => selection
});

Object.assign(globalThis, {
  window,
  document,
  Element: FakeElement,
  HTMLElement: FakeElement,
  Event: FakeEvent,
  InputEvent: FakeEvent,
  ClipboardEvent: FakeClipboardEvent,
  DataTransfer: FakeDataTransfer
});

await import(`../lib/client.js?repeat-test=${Date.now()}`);
assert.equal(typeof clientModule?.apply, "function");

// A browser tab may retain the old boolean singleton and old shared-id button
// while the Web server restarts. The new client must take ownership instead of
// treating that stale marker as proof that the current version is mounted.
const staleButton = new FakeElement("button");
staleButton.id = "dsh-quote-followup-btn";
document.body.appendChild(staleButton);
globalThis[Symbol.for("dsh-quote-followup.mounted")] = true;
clientModule.apply({ effect() {} });

const quote = (text) => {
  selection.isCollapsed = false;
  selection.rangeCount = 1;
  selection.anchorNode = startNode;
  selection.focusNode = startNode;
  selection.text = text;
  selection.range = makeTranscriptRange();
  document.dispatchEvent(new FakeEvent("selectionchange"));
  const button = document.getElementById("dsh-quote-followup-btn");
  assert.ok(button, "quote button mounted");
  assert.notEqual(button, staleButton, "current client replaces a stale shared-id button");
  assert.equal(button.style.display, "block");
  button.dispatchEvent(new FakeEvent("mousedown", { cancelable: true }));
  button.dispatchEvent(new FakeEvent("click", { cancelable: true }));
  assert.equal(focusSawClearedTranscript, true, "transcript selection cleared before composer focus");
};

quote("first fragment");
quote("second fragment");

assert.match(editorDraft, /> first fragment/);
assert.match(editorDraft, /> second fragment/);
assert.equal((editorDraft.match(/> \[引用/g) ?? []).length, 2);

// Firefox can reject constructor-injected clipboardData. A Lexical-backed
// composer must therefore take the editor command path before DOM fallbacks.
editorDraft = "";
composer.lastElementChild = null;
syntheticClipboardEnabled = false;
rawFallbackEnabled = false;
const pasteCommand = { type: "PASTE_COMMAND" };
composer.__lexicalEditor = {
  _commands: new Map([[pasteCommand, true]]),
  dispatchCommand(command, event) {
    if (command !== pasteCommand) return false;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text === "") return false;
    event.preventDefault();
    editorDraft += text;
    composer.lastElementChild ??= new FakeElement("p", composer);
    return true;
  }
};
quote("firefox first fragment");
quote("firefox second fragment");
assert.match(editorDraft, /> firefox first fragment/);
assert.match(editorDraft, /> firefox second fragment/);
assert.equal((editorDraft.match(/> \[引用/g) ?? []).length, 2);
console.log("[web-repeat] Chromium fallback + Firefox Lexical command + stale takeover PASS");
