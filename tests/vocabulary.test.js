const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadVocabularyHelpers(documentOverrides = {}) {
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval() {},
    clearInterval() {},
    IntersectionObserver: class {},
    CSS: { escape: (value) => value },
    window: { getSelection: () => null, close() {} },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => {
        let value = "";
        return {
          set textContent(text) {
            value = String(text);
          },
          get innerHTML() {
            return value
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll('"', "&quot;");
          },
        };
      },
    },
    chrome: {
      runtime: { onMessage: listeners, sendMessage: () => Promise.resolve({}) },
      windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
    YTD_SETTINGS: {},
  };
  sandbox.globalThis = sandbox;
  Object.assign(sandbox.document,documentOverrides);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'vocabulary-context.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'vocabulary-learning.js'), 'utf8'), sandbox);
  vm.runInNewContext(read("sidepanel.js"), sandbox);
  return sandbox.__YTD_TRANSCRIPT_TESTING__;
}

test("vocabulary matching ignores case and protects word boundaries", () => {
  const { findVocabularyMatches } = loadVocabularyHelpers();
  const result = findVocabularyMatches("Agent agents agentic AGENT", [
    { id: "word-1", term: "agent" },
  ]);

  assert.deepEqual(
    JSON.parse(JSON.stringify(result.map(({ start, end }) => ({ start, end })))),
    [
      { start: 0, end: 5 },
      { start: 21, end: 26 },
    ],
  );
});

test('Single click selects words with apostrophes and hyphens but ignores punctuation',()=>{
  const {transcriptWordBounds}=loadVocabularyHelpers();
  const text="It's a built-in tool.";
  const selected=offset=>{const bounds=transcriptWordBounds(text,offset);return bounds ? text.slice(bounds.start,bounds.end) : null;};
  assert.equal(selected(2),"It's");
  assert.equal(selected(11),'built-in');
  assert.equal(selected(20),null);
});

test('The panel distinguishes standalone Descript video IDs from YouTube IDs',()=>{
  const {extractVideoId}=loadVocabularyHelpers();
  assert.equal(extractVideoId('https://share.descript.com/view/demo?transcript=true'),'descript:demo');
  assert.equal(extractVideoId('https://share.descript.com/embed/demo'),'descript:demo');
  assert.equal(extractVideoId('https://share.descript.com/settings'),null);
});

test("longer saved phrases win over overlapping individual words", () => {
  const { findVocabularyMatches } = loadVocabularyHelpers();
  const result = findVocabularyMatches("machine learning helps learning", [
    { id: "word-1", term: "learning" },
    { id: "word-2", term: "machine learning" },
  ]);

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        result.map(({ start, end, entry }) => ({ start, end, id: entry.id })),
      ),
    ),
    [
      { start: 0, end: 16, id: "word-2" },
      { start: 23, end: 31, id: "word-1" },
    ],
  );
});

test("Chinese meanings highlight inline and stay bound to the English source row", () => {
  const { findTranslatedVocabularyMatches } = loadVocabularyHelpers();
  const entries = [
    {id:"built-in",term:"built-in",meaningZh:"内置的；自带的"},
    {id:"middleware",term:"middleware",meaningZh:"中间件"},
    {id:"feature",term:"feature",meaningZh:"功能"},
  ];
  const matches = findTranslatedVocabularyMatches("这是中间件，有很多内置功能。", "middleware has built-in tools", entries);
  assert.deepEqual(Array.from(matches, m => m.entry.id), ["middleware", "built-in"]);
  assert.deepEqual(Array.from(matches, m => "这是中间件，有很多内置功能。".slice(m.start,m.end)), ["中间件", "内置"]);
  assert.equal(findTranslatedVocabularyMatches("这是内置功能。", "ordinary tools", entries).length,0);
});

test("Retained English terms and alternative Chinese meanings use the same vocabulary identity", () => {
  const { findTranslatedVocabularyMatches } = loadVocabularyHelpers();
  const entry={id:"middleware",term:"middleware",meaningZh:"中间件（软件层）；中介软件"};
  const matches=findTranslatedVocabularyMatches("middleware 是中介软件。", "This is middleware.", [entry]);
  assert.deepEqual(Array.from(matches,m=>m.entry.id),["middleware","middleware"]);
});

test("Contextual alignment highlights actual translation wording rather than dictionary glosses", () => {
  const {findTranslatedVocabularyMatches}=loadVocabularyHelpers();
  const entries=[{id:'first',term:'first off',meaningZh:'首先说来'}, {id:'loop',term:'tool calling loop',meaningZh:'反复调用工具的过程'}];
  const matches=findTranslatedVocabularyMatches('首先，模型在工具调用循环中运行。','first off, a model in a tool calling loop',entries,[{id:'first',text:'首先'},{id:'loop',text:'工具调用循环'}]);
  assert.deepEqual(Array.from(matches,m=>m.entry.id),['first','loop']);
});

test("Pointer hover renders a visible definition tooltip and removes it on leave", () => {
  let tooltip;
  const helpers=loadVocabularyHelpers({
    getElementById:()=>tooltip,
    body:{appendChild:node=>{tooltip=node;}},
    createElement:()=>({style:{},offsetWidth:200,offsetHeight:100,setAttribute(){},remove(){tooltip=null;}}),
  });
  const events={};
  const mark={setAttribute(){},removeAttribute(){},closest:()=>null,getBoundingClientRect:()=>({left:10,bottom:20}),addEventListener:(name,fn)=>{events[name]=fn;}};
  helpers.attachVocabularyTooltip(mark,{term:'first off',ipa:'/fɝst ɔf/',meaningZh:'首先',meaningEn:'to begin with'});
  events.pointerenter();
  assert.equal(tooltip.id,'vocabularyMeaningTooltip');
  assert.match(tooltip.textContent,/first off\n.*\n首先\nto begin with/);
  events.pointerleave();assert.equal(tooltip,null);
  events.focus();assert.ok(tooltip);events.keydown({key:'Escape'});assert.equal(tooltip,null);
});

test("vocabulary UI and local-storage message flow are wired", () => {
  const html = read("sidepanel.html");
  const panel = read("sidepanel.js");
  const background = read("background.js");

  assert.match(html, /data-tab="vocabulary"[\s\S]*id="vocabularyList"/);
  assert.match(panel, /class="selection-vocabulary-btn"[\s\S]*Save word/);
  assert.match(panel, /event\.key\?\.toLocaleLowerCase\(\) === "w"/);
  assert.match(panel, /tooltip\.style\.display === "none"/);
  assert.match(panel, /input, textarea, select, \[contenteditable='true'\]/);
  assert.match(panel, /action:\s*"saveVocabulary"/);
  assert.match(panel, /applyVocabularyHighlights\(transcriptList\)/);
  assert.match(background, /VOCABULARY_STORAGE_KEY = "ytd_vocabulary"/);
  assert.match(background, /action === "deleteVocabulary"/);
});

test('video vocabulary excludes unrelated videos and uses its own source for shared words', () => {
  const { vocabularyForVideo } = loadVocabularyHelpers();
  const entries = [
    { id: 'shared', term: 'nuanced', videoId: 'first', context: 'First sentence.', occurrences: [
      { videoId: 'first', context: 'First sentence.', timestampSeconds: 1 },
      { videoId: 'second', context: 'A nuanced second sentence.', timestampSeconds: 42 },
    ] },
    { id: 'unrelated', term: 'election', videoId: 'first' },
    { id: 'legacy', term: 'take into account', videoId: 'first' },
  ];
  const result = vocabularyForVideo(entries, 'second', [{ start: 42, text: 'A nuanced second sentence.' }, { start: 70, text: 'Take into account the context.' }], 'Second video');
  assert.deepEqual(Array.from(result, entry => entry.id), ['shared', 'legacy']);
  assert.equal(result[0].context, 'A nuanced second sentence.');
  assert.equal(result[0].timestampSeconds, 42);
  assert.equal(result[1].videoId, 'second');
  assert.equal(result[1].timestampSeconds, 70);
  assert.equal(result[1].videoTitle, 'Second video');
  assert.equal(entries[2].videoId, 'first');
  assert.equal(vocabularyForVideo(entries, null).length, 0);
});

test('video vocabulary interleaves words and phrases in timestamp and sentence order without mutating storage', () => {
  const { vocabularyForVideo } = loadVocabularyHelpers();
  const context = 'Nuanced ideas take into account the context.';
  const entries = [
    { id: 'late', term: 'subtle', videoId: 'video', timestampSeconds: 90 },
    { id: 'phrase', term: 'take into account', videoId: 'video', timestampSeconds: 12.5, context },
    { id: 'word', term: 'nuanced', videoId: 'video', timestampSeconds: 12.5, context },
    { id: 'first', term: 'first off', videoId: 'video', timestampSeconds: 0 },
    { id: 'unknown', term: 'unknown', videoId: 'video' },
  ];
  const result = vocabularyForVideo(entries, 'video');
  assert.deepEqual(Array.from(result, entry => entry.id), ['first', 'word', 'phrase', 'late', 'unknown']);
  assert.deepEqual(entries.map(entry => entry.id), ['late', 'phrase', 'word', 'first', 'unknown']);
});

test('old mismatched originals are resolved from the current transcript, including split phrases', () => {
  const { vocabularyForVideo, renderVocabularyOriginal } = loadVocabularyHelpers();
  const entry = { id: 'phrase', term: 'take into account', videoId: 'video', context: 'A built-in tool.', timestampSeconds: 40 };
  const result = vocabularyForVideo([entry], 'video', [
    { start: 1, text: 'Introduction.' },
    { start: 40, text: 'We take into' },
    { start: 42, text: 'account the context. Next topic.' },
  ]);
  assert.equal(result[0].context, 'We take into account the context.');
  assert.equal(result[0].timestampSeconds, 40);
  assert.equal(renderVocabularyOriginal(result[0]), 'We <mark>take into account</mark> the context.');
  assert.equal(entry.context, 'A built-in tool.');
  assert.equal(vocabularyForVideo([entry], 'video', [{ start: 1, text: 'Unrelated text.' }])[0].context, '');
});

test('source sentences use the saved occurrence among repeated terms and escape HTML', () => {
  const { vocabularyForVideo, renderVocabularyOriginal } = loadVocabularyHelpers();
  const result = vocabularyForVideo([{ id: 'word', term: 'nuanced', videoId: 'video', timestampSeconds: 50 }], 'video', [
    { start: 1, text: 'A nuanced opening.' },
    { start: 50, text: 'A nuanced <ending>.' },
  ]);
  assert.equal(result[0].context, 'A nuanced <ending>.');
  assert.equal(renderVocabularyOriginal(result[0]), 'A <mark>nuanced</mark> &lt;ending&gt;.');
});

test('vocabulary arrows navigate one entry at a time, stop at boundaries, and ignore typing or other tabs', () => {
  const scrolled = [];
  const items = ['first', 'second', 'third'].map(id => ({
    dataset: { entryId: id },
    classList: { toggle() {} },
    setAttribute() {}, removeAttribute() {},
    scrollIntoView() { scrolled.push(id); },
  }));
  const previous = {}, next = {}, position = {};
  let active = true;
  const helpers = loadVocabularyHelpers({
    getElementById: id => ({
      vocabularyList: { querySelectorAll: () => items },
      vocabularyPrevious: previous, vocabularyNext: next, vocabularyPosition: position,
    })[id] || null,
    querySelector: () => active ? {} : null,
  });
  let prevented = 0;
  const event = key => ({ key, target: { closest: () => null },
    preventDefault() { prevented++; }, stopPropagation() {} });
  assert.equal(helpers.navigateVocabulary(0), true);
  assert.equal(previous.disabled, true);
  assert.equal(position.textContent, '1 / 3');
  helpers.handleVocabularyShortcut(event('ArrowRight'));
  assert.equal(position.textContent, '2 / 3');
  helpers.handleVocabularyShortcut({ ...event('ArrowRight'), target: { closest: () => ({}) } });
  helpers.handleVocabularyShortcut({ ...event('ArrowRight'), ctrlKey: true });
  active = false;
  helpers.handleVocabularyShortcut(event('ArrowRight'));
  assert.equal(position.textContent, '2 / 3');
  active = true;
  helpers.handleVocabularyShortcut(event('ArrowRight'));
  assert.equal(next.disabled, true);
  assert.equal(helpers.navigateVocabulary(1), false);
  helpers.handleVocabularyShortcut(event('ArrowLeft'));
  assert.equal(position.textContent, '2 / 3');
  assert.deepEqual(scrolled, []);
  assert.equal(items.filter(item => !item.hidden).length, 1);
  assert.equal(items[1].hidden, false);
  assert.equal(prevented, 3);
  items.length = 0;
  assert.equal(helpers.navigateVocabulary(1), false);
  assert.equal(position.textContent, '0 / 0');
  assert.equal(previous.disabled, true);
  assert.equal(next.disabled, true);
});
