import assert from "node:assert/strict";

let syntheticClipboardEnabled = true;
let nativeChipEnabled = true;
let lexicalPasteEnabled = true;

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
    // Firefox drops the clipboardData ctor option but leaves the property
    // reconfigurable, so pasteIntoEditor can re-attach a DataTransfer.
    super(type, { ...init, clipboardData: syntheticClipboardEnabled ? init.clipboardData : null });
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
      if (selector === "[data-chat-turn]" && cursor.attributes.has("data-chat-turn")) return cursor;
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
// A DSH chat renderer message row: carries the per-session turn ordinal that
// the plugin resolves into serialized provenance.
const turnRow = new FakeElement("article", transcript);
turnRow.setAttribute("data-chat-turn", "3");
const turnStartNode = { nodeType: 3, parentElement: turnRow };
// Invalid marker values must degrade to "no provenance" instead of NaN.
const badTurnRow = new FakeElement("article", transcript);
badTurnRow.setAttribute("data-chat-turn", "not-a-number");
// A message row carrying a role marker, for localized serialized headers.
const userRow = new FakeElement("article", transcript);
userRow.setAttribute("data-role", "user");
const userRoleNode = { nodeType: 3, parentElement: userRow };
const composer = new FakeElement("div");
composer.setAttribute("contenteditable", "true");
let editorDraft = "";
let draftRevision = 0;
let inputPhase = "plain";
let sessionId = "alpha";
let nativeInsertAllowed = true;
let focusSawClearedTranscript = false;
let rawFallbackEnabled = true;

class FakeTextNode {
  constructor(text) { this.text = text; }
  getTextContent() { return this.text; }
  selectEnd() {}
}
class FakeReferenceChipNode {
  constructor(insert) { this.insert = insert; }
  getTextContent() { return this.insert.clipboardText; }
}
const fakeInput = {
  state: {
    getSnapshot() {
      const paragraph = root.getLastChild();
      let offset = 0;
      const occurrences = [];
      for (const node of paragraph?.children ?? []) {
        if (node instanceof FakeReferenceChipNode) {
          occurrences.push({ offset, length: node.getTextContent().length });
        }
        offset += node.getTextContent().length;
      }
      return { draft: editorDraft, draftRev: draftRevision, phase: inputPhase, occurrences };
    }
  },
  insertText(text, span) {
    if (span.draftRev !== draftRevision || span.start !== this.detectEnd()) return false;
    root.getLastChild().append(new FakeTextNode(text));
    return true;
  },
  insertReference(insert, span) {
    if (!nativeInsertAllowed || inputPhase !== "plain" || span.draftRev !== draftRevision || span.start !== this.detectEnd()) return false;
    let paragraph = root.getLastChild();
    if (paragraph === null) {
      paragraph = new FakeParagraphNode();
      root.append(paragraph);
    }
    paragraph.append(new FakeReferenceChipNode(insert), new FakeTextNode(" "));
    return true;
  },
  detectEnd() {
    const state = this.state.getSnapshot();
    return state.draft.length - state.occurrences.reduce((n, row) => n + row.length - 1, 0);
  }
};
class FakeParagraphNode {
  children = [];
  append(...nodes) {
    this.children.push(...nodes);
    composer.lastElementChild ??= new FakeElement("p", composer);
    editorDraft = root.getTextContent();
    draftRevision += 1;
  }
  getTextContent() { return this.children.map((node) => node.getTextContent()).join(""); }
}
class FakeRootNode {
  children = [];
  append(...nodes) { this.children.push(...nodes); editorDraft = this.getTextContent(); draftRevision += 1; }
  getLastChild() { return this.children.at(-1) ?? null; }
  getTextContent() { return this.children.map((node) => node.getTextContent()).join("\n"); }
  clear() { this.children = []; editorDraft = ""; draftRevision += 1; }
}
const root = new FakeRootNode();

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
  if (editorDraft !== "" && selection.anchorNode === composer) return;
  event.preventDefault();
  editorDraft += text;
  composer.lastElementChild ??= new FakeElement("p", composer);
});

const makeTranscriptRange = (selectedNode = startNode) => ({
  startContainer: selectedNode,
  getBoundingClientRect: () => ({ left: 100, top: 100, bottom: 120, width: 80, height: 20 })
});
const makeComposerRange = () => ({
  selectedNode: null,
  selectNodeContents(node) { this.selectedNode = node; },
  collapse() {},
  insertNode(node) {
    if (rawFallbackEnabled && (editorDraft === "" || this.selectedNode !== composer)) editorDraft += node.textContent;
  }
});

const documentTarget = new FakeTarget();
const document = Object.assign(documentTarget, {
  head: {
    appendChild(element) {
      if (element.id !== "") elementsById.set(element.id, element);
    }
  },
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
  querySelector: (selector) => selector === '[data-composer-input]' ? composer : null
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

const pasteCommand = { type: "PASTE_COMMAND" };
const nativeNodes = new Map([
  ["reference-chip", { klass: FakeReferenceChipNode }],
  ["text", { klass: FakeTextNode }],
  ["paragraph", { klass: FakeParagraphNode }]
]);
composer.__lexicalEditor = {
  get _nodes() { return nativeChipEnabled ? nativeNodes : new Map(); },
  get _commands() { return lexicalPasteEnabled ? new Map([[pasteCommand, true]]) : new Map(); },
  _editorState: { _nodeMap: new Map([["root", root]]) },
  _pendingEditorState: null,
  update(fn) {
    this._pendingEditorState = this._editorState;
    try { fn(); } finally { this._pendingEditorState = null; }
  },
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

await import(`../lib/client.js?repeat-test=${Date.now()}`);
assert.equal(typeof clientModule?.apply, "function");
assert.deepEqual(clientModule.inject, ["inputTriggers", "locale", "sessions"]);

let quoteSource = null;
const inputTriggers = {
  registerSource(source) {
    assert.equal(source.name, "quote-followup");
    quoteSource = source;
    return () => { if (quoteSource === source) quoteSource = null; };
  }
};

let activeLocale = "en";
let localeDict = null;
let localeSubscriber = null;
const locale = {
  register(ns, dicts) {
    assert.equal(ns, "quote-followup");
    localeDict = dicts;
    return () => { localeDict = null; };
  },
  bind() { return (key) => (localeDict?.[activeLocale] ?? localeDict?.en)?.[key] ?? key; },
  subscribe(fn) { localeSubscriber = fn; return () => { localeSubscriber = null; }; }
};

const staleButton = new FakeElement("button");
staleButton.id = "dsh-quote-followup-btn";
document.body.appendChild(staleButton);
// Simulate a previously mounted client instance so apply() must dispose it
// before taking over (the singleton no-op/dispose branch from AGENTS.md #6).
let staleStateDisposed = false;
globalThis[Symbol.for("dsh-quote-followup.state")] = {
  version: "0.0.0",
  dispose() { staleStateDisposed = true; }
};
clientModule.apply({
  get(name) {
    if (name === "inputTriggers") return inputTriggers;
    if (name === "locale") return locale;
    if (name === "sessions") return {
      list: { getSnapshot: () => ({ current: sessionId }) },
      scope: (id) => id === sessionId ? {
        sessionId: id,
        get: (service) => service === "conversation" ? {
          input: { for: (scope) => scope.sessionId === sessionId ? fakeInput : undefined }
        } : undefined
      } : undefined
    };
    throw new Error("unexpected " + name);
  },
  effect(setup) { return setup(); }
});
assert.equal(staleStateDisposed, true, "stale singleton state disposed on takeover");
assert.ok(quoteSource, "quote codec source registered");
assert.equal(document.getElementById("dsh-quote-followup-btn").textContent, "❐ Quote");
// The versioned stylesheet is injected next to the button (theme-token pill).
const injectedStyle = document.getElementById("dsh-quote-followup-style");
assert.ok(injectedStyle, "quote button stylesheet injected");
assert.match(String(injectedStyle.textContent), /dsh-qf-btn/);
assert.equal(
  injectedStyle.getAttribute("data-dsh-quote-followup-style-version"),
  document.getElementById("dsh-quote-followup-btn").getAttribute("data-dsh-quote-followup-version"),
  "style version tracks the button version"
);

const quote = (text, selectedNode = startNode) => {
  selection.isCollapsed = false;
  selection.rangeCount = 1;
  selection.anchorNode = selectedNode;
  selection.focusNode = selectedNode;
  selection.text = text;
  selection.range = makeTranscriptRange(selectedNode);
  document.dispatchEvent(new FakeEvent("selectionchange"));
  const button = document.getElementById("dsh-quote-followup-btn");
  assert.ok(button, "quote button mounted");
  assert.notEqual(button, staleButton, "current client replaces a stale shared-id button");
  assert.equal(button.style.display, "inline-flex");
  button.dispatchEvent(new FakeEvent("mousedown", { cancelable: true }));
  button.dispatchEvent(new FakeEvent("click", { cancelable: true }));
  assert.equal(focusSawClearedTranscript, true, "transcript selection cleared before composer focus");
};

// Native path: repeated selections become DSH ReferenceChipNode instances.
quote("first fragment");
quote("second fragment");
const paragraph = root.getLastChild();
const chips = paragraph.children.filter((node) => node instanceof FakeReferenceChipNode);
assert.equal(chips.length, 2);
assert.equal(chips[0].insert.source, "quote-followup");
assert.equal(chips[0].insert.appearance, "session");
assert.equal(chips[0].insert.label, "first fragment");
assert.doesNotMatch(chips[0].insert.label, /^引用|^assistant|^user/);
assert.match(editorDraft, /> first fragment/);
assert.match(editorDraft, /> second fragment/);
assert.equal(await quoteSource.codec.serialize(chips[0].insert.ref), chips[0].insert.clipboardText);
assert.match(await quoteSource.codec.serialize(chips[0].insert.ref), /^> \[Quote · conversation\]/);
activeLocale = "zh";
assert.match(await quoteSource.codec.serialize(chips[0].insert.ref), /^> \[引用 · 对话\]/);
activeLocale = "en";

// Existing draft receives a separating space before the native chip.
root.clear();
composer.lastElementChild = null;
const draftParagraph = new FakeParagraphNode();
root.append(draftParagraph);
draftParagraph.append(new FakeTextNode("existing draft"));
quote("after draft");
assert.match(editorDraft, /^existing draft > \[Quote · conversation\]/);

// A selection inside a chat row carries its turn ordinal into the serialized
// frame, in both locales, without changing the visible chip label.
root.clear();
composer.lastElementChild = null;
quote("turn three excerpt", turnStartNode);
const turnChip = root.getLastChild().children.find((node) => node instanceof FakeReferenceChipNode);
assert.equal(turnChip.insert.label, "turn three excerpt");
assert.deepEqual(JSON.parse(turnChip.insert.ref), {
  text: "turn three excerpt",
  role: null,
  truncated: false,
  turn: 3
});
assert.equal(await quoteSource.codec.serialize(turnChip.insert.ref), "> [Quote · conversation · turn 3]\n> turn three excerpt\n\n");
activeLocale = "zh";
assert.equal(await quoteSource.codec.serialize(turnChip.insert.ref), "> [引用 · 对话 · 第 3 轮]\n> turn three excerpt\n\n");
activeLocale = "en";

// An unparsable turn marker degrades to the provenance-free frame.
root.clear();
composer.lastElementChild = null;
quote("no provenance excerpt", (() => ({ nodeType: 3, parentElement: badTurnRow }))());
const plainChip = root.getLastChild().children.find((node) => node instanceof FakeReferenceChipNode);
assert.equal(JSON.parse(plainChip.insert.ref).turn, null);
assert.equal(await quoteSource.codec.serialize(plainChip.insert.ref), "> [Quote · conversation]\n> no provenance excerpt\n\n");

// A role marker localizes the serialized header; the chip label stays clean.
root.clear();
composer.lastElementChild = null;
quote("user role excerpt", userRoleNode);
const roleChip = root.getLastChild().children.find((node) => node instanceof FakeReferenceChipNode);
assert.equal(roleChip.insert.label, "user role excerpt");
assert.equal(await quoteSource.codec.serialize(roleChip.insert.ref), "> [Quote · user]\n> user role excerpt\n\n");
activeLocale = "zh";
assert.equal(await quoteSource.codec.serialize(roleChip.insert.ref), "> [引用 · 用户]\n> user role excerpt\n\n");
activeLocale = "en";

// Malformed chip refs degrade to an empty projection instead of throwing.
assert.equal(await quoteSource.codec.serialize("not json"), "");
assert.equal(quoteSource.codec.clipboardText("not json"), "");
assert.equal(await quoteSource.codec.serialize(JSON.stringify({ text: 42 })), "");

// The facade's published clipboard offsets differ from chip-aware detect offsets.
root.clear();
composer.lastElementChild = null;
const longParagraph = new FakeParagraphNode();
root.append(longParagraph);
longParagraph.append(new FakeTextNode("prefix"));
quote("long clipboard expansion");
quote("append after an existing chip");
assert.equal(longParagraph.children.filter(node => node instanceof FakeReferenceChipNode).length, 2);
assert.match(root.getTextContent(), /prefix > \[Quote · conversation\]/);

// A supported facade refusing an edit must not be bypassed by text paste.
root.clear();
composer.lastElementChild = null;
inputPhase = "adjudicating";
quote("rejected while busy");
assert.equal(root.getTextContent(), "", "busy phase cannot be bypassed by text fallback");
inputPhase = "plain";
nativeInsertAllowed = false;
quote("rejected reference");
assert.equal(root.getTextContent(), "", "failed scoped insert cannot be bypassed by text fallback");
nativeInsertAllowed = true;

// Firefox fallback: without a scoped input service or Lexical paste command,
// the quote survives the synthetic ClipboardEvent path (DataTransfer re-attach).
root.clear();
composer.lastElementChild = null;
editorDraft = "";
sessionId = undefined;
nativeChipEnabled = false;
lexicalPasteEnabled = false;
syntheticClipboardEnabled = false;
rawFallbackEnabled = false;
quote("firefox first fragment");
quote("firefox second fragment");
assert.match(editorDraft, /> firefox first fragment/);
assert.match(editorDraft, /> firefox second fragment/);
assert.equal((editorDraft.match(/> \[Quote · conversation\]/g) ?? []).length, 2);
console.log("[web-repeat] native quote chips + draft spacing + Firefox fallback + stale takeover PASS");
