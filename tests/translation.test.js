const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test('Vocabulary alignment rejects invented substrings and unrelated vocabulary IDs',()=>{
  const {validateVocabularyAlignment}=loadBackgroundHelpers();
  const rows=[{id:'row',translation:'那么首先，工具调用循环。',entries:[{id:'first'},{id:'loop'}]}];
  const result=validateVocabularyAlignment({rows:[{id:'row',matches:[{id:'first',text:'首先'},{id:'loop',text:'工具调用循环'},{id:'first',text:'不存在'},{id:'unknown',text:'那么'},{id:'first',text:'首先'}]}]},rows);
  assert.deepEqual(Array.from(result[0].matches,m=>m.text),['首先','工具调用循环']);
  assert.equal(validateVocabularyAlignment({rows:{}},rows)[0].matches.length,0);
});

test('Standalone Descript relay reads metadata and playback without using YouTube APIs',async()=>{
  const {handleRelayToContent}=loadBackgroundHelpers({tabApi:{get:async()=>({url:'https://share.descript.com/view/demo?transcript=true'}),sendMessage:async()=>{throw new Error('Should use native frame adapter');}},scripting:{executeScript:async options=>[{result:{success:true,videoId:'descript:demo',currentTime:12,title:'Demo'}}]}});
  for (const action of ['getVideoInfo','getCurrentTime','seekTo']) {
    const result=await handleRelayToContent({tabId:1,videoId:'descript:demo',payload:{action,seconds:20}});
    assert.equal(result.success,true);assert.equal(result.response.videoId,'descript:demo');
  }
  assert.equal((await handleRelayToContent({tabId:1,videoId:'descript:other',payload:{action:'seekTo',seconds:20}})).success,false);
});

test('Saved Descript notes link to the source sharing page',async()=>{
  const {handleSaveNote}=loadBackgroundHelpers();
  const result=await handleSaveNote('descript:demo',12,'Demo','Descript','Selected words');
  assert.equal(result.note.timestampedUrl,'https://share.descript.com/view/demo?transcript=true');
});

function loadSidepanelHelpers({
  initialStorage = {},
  reader = false,
  sendMessage = () => Promise.resolve({}),
  setTimeoutImpl = () => 0,
  clearTimeoutImpl = () => {},
} = {}) {
  const listeners = { addListener() {} };
  const sessionStorage = {};
  const localStorage = initialStorage;
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    setInterval() {},
    clearInterval() {},
    IntersectionObserver: class {},
    CSS: { escape: (value) => value },
    window: { digestReader: reader ? {} : undefined, getSelection: () => null, close() {} },
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
      runtime: { onMessage: listeners, sendMessage },
      storage: {
        local: {
          get: async (key) => ({ [key]: localStorage[key] }),
          set: async (values) => Object.assign(localStorage, values),
        },
        session: {
          get: async (key) => ({ [key]: sessionStorage[key] }),
          set: async (values) => Object.assign(sessionStorage, values),
        },
      },
      windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
    YTD_SETTINGS: {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("sidepanel.js"), sandbox);
  return sandbox.__YTD_TRANSCRIPT_TESTING__;
}

function loadBackgroundHelpers({
  scripting = {},
  tabApi = {},
  settings = {
    provider: "deepseek",
    aiApiKey: "test-key",
    aiBaseUrl: "https://api.deepseek.com",
    aiModel: "deepseek-v4-flash",
  },
  fetchImpl = fetch,
  initialStorage = {},
  setTimeoutImpl = () => 0,
  clearTimeoutImpl = () => {},
  sidePanel = {
    setPanelBehavior() {},
    setOptions: () => Promise.resolve(),
  },
} = {}) {
  const listeners = { addListener() {} };
  const localStorage = { ytd_settings: settings, ...initialStorage };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    fetch: fetchImpl,
    AbortController,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    importScripts() {},
    chrome: {
      storage: {
        local: {
          setAccessLevel: () => Promise.resolve(),
          get: async (key) => {
            if (key === null) return { ...localStorage };
            if (Array.isArray(key)) {
              return Object.fromEntries(key.map((item) => [item, localStorage[item]]));
            }
            return { [key]: localStorage[key] };
          },
          set: async (values) => Object.assign(localStorage, values),
          remove: async (keys) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
              delete localStorage[key];
            }
          },
        },
      },
      action: { onClicked: listeners },
      sidePanel,
      runtime: {
        onInstalled: listeners,
        onMessage: listeners,
        openOptionsPage() {},
        getURL: (resourcePath) => `chrome-extension://test/${resourcePath}`,
        sendMessage: () => Promise.resolve({ success: true }),
      },
      tabs: { onUpdated: listeners, onActivated: listeners, ...tabApi },
      scripting,
    },
    YTD_SETTINGS: {
      STORAGE_KEY: "ytd_settings",
      normalize: (value) => value,
      chatCompletionsUrl: (baseUrl) => `${baseUrl}/chat/completions`,
      canonicalYouTubeUrl: (videoId) =>
        `https://www.youtube.com/watch?v=${videoId}`,
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("academy.js"), sandbox);
  vm.runInNewContext(read("lesson-highlight-store.js"), sandbox);
  vm.runInNewContext(read("background.js"), sandbox);
  return sandbox.__YTD_TRANSLATION_TESTING__;
}

test("non-YouTube tabs explicitly close before their panel is disabled", async () => {
  const calls = [];
  const background = loadBackgroundHelpers({
    sidePanel: {
      setPanelBehavior() {},
      close: async (options) => calls.push(["close", options]),
      setOptions: async (options) => calls.push(["setOptions", options]),
    },
  });

  await background.updatePanelForTab(17, "https://example.com/page", 4);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["close", { tabId: 17 }],
    ["setOptions", { tabId: 17, enabled: false }],
  ]);
});

test("a global panel closes by window when the tab close is rejected", async () => {
  const calls = [];
  const background = loadBackgroundHelpers({
    sidePanel: {
      setPanelBehavior() {},
      close: async (options) => {
        calls.push(["close", options]);
        if (options.tabId) throw new Error("Global panel");
      },
      setOptions: async (options) => calls.push(["setOptions", options]),
    },
  });

  await background.updatePanelForTab(17, "https://example.com/page", 4);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["close", { tabId: 17 }],
    ["close", { windowId: 4 }],
    ["setOptions", { tabId: 17, enabled: false }],
  ]);
});

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay, active: true });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) timer.active = false;
    },
    fireActive(delay) {
      const match = [...timers.entries()].find(
        ([, timer]) => timer.active && timer.delay === delay,
      );
      assert.ok(match, `Expected an active ${delay}ms timer`);
      match[1].active = false;
      match[1].callback();
    },
    activeCount(delay) {
      return [...timers.values()].filter(
        (timer) => timer.active && timer.delay === delay,
      ).length;
    },
    createdCount(delay) {
      return [...timers.values()].filter((timer) => timer.delay === delay).length;
    },
  };
}

function streamingResponse(chunks, { ok = true, status = 200 } = {}) {
  let index = 0;
  return {
    ok,
    status,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true };
            return { done: false, value: chunks[index++] };
          },
          async cancel() {},
        };
      },
    },
  };
}

const encode = (value) => new TextEncoder().encode(value);
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("the header exposes one universal language control for all result tabs", () => {
  const html = read("sidepanel.html");
  const js = read("sidepanel.js");
  assert.match(html, /id="transcriptModeControl"[\s\S]*aria-label="Content language"/);
  assert.match(html, /id="transcriptModeControl"[\s\S]*id="tabsNav"/);
  assert.match(html, /data-transcript-mode="original"[\s\S]*?>Original</);
  assert.match(html, /data-transcript-mode="zh"[\s\S]*?>\u4e2d\u6587</);
  assert.match(html, /data-transcript-mode="bilingual"[\s\S]*?>\u53cc\u8bed</);
  assert.match(js, /handleDisplayLanguageModeChange\(button\.dataset\.transcriptMode\)/);
  assert.match(js, /contentType: "transcriptBatch"/);
  assert.match(js, /contentType: "interfaceBatch"/);
  assert.match(js, /translateOverviewContent/);
  assert.match(js, /translateNotesContent/);
  assert.doesNotMatch(js, /English \+ Chinese/);
  assert.doesNotMatch(`${html}\n${js}`, /From video subtitles/);
});

test("every video open defaults to bilingual Transcript", async () => {
  const { loadDisplayLanguageMode } = loadSidepanelHelpers();

  assert.match(read("sidepanel.html"), /class="tab active" data-tab="transcript"/);
  assert.match(read("sidepanel.html"), /class="tab-panel active" data-panel="transcript"/);
  assert.equal(await loadDisplayLanguageMode("video-a"), "bilingual");
  assert.equal(await loadDisplayLanguageMode("unseen-video"), "bilingual");
  assert.doesNotMatch(read("sidepanel.js"), /saveDisplayLanguageMode/);
  assert.match(
    read("sidepanel.html"),
    /data-transcript-mode="bilingual"\s+aria-pressed="true"/,
  );
});

test("Chinese fallback cannot be presented as original English captions", () => {
  const { checkEnglishCaptionResponse } = loadBackgroundHelpers();
  const chinese = { lang: "zh-CN", content: [{ text: "大家好，今天我们来讨论人工智能记忆系统。" }] };
  const mislabeled = { lang: "en", content: [{ text: "大家好，今天我们来讨论人工智能记忆系统。" }] };
  const english = { lang: "en", content: [{ text: "Hello, today we will discuss AI memory systems." }] };
  assert.equal(checkEnglishCaptionResponse(chinese).error, "ENGLISH_CAPTIONS_UNAVAILABLE");
  assert.equal(checkEnglishCaptionResponse(mislabeled).error, "ENGLISH_CAPTIONS_UNAVAILABLE");
  assert.equal(checkEnglishCaptionResponse(english), null);
});

test("transcript fetch requests English and rejects a Chinese fallback", async () => {
  let requestUrl;
  const { handleFetchTranscript } = loadBackgroundHelpers({
    settings: { supadataApiKey: "test-key" },
    fetchImpl: async (url) => {
      requestUrl = new URL(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          lang: "zh",
          content: [{ text: "大家好，今天我们讨论记忆系统。", offset: 0 }],
        }),
      };
    },
  });
  const result = await handleFetchTranscript("dQw4w9WgXcQ");
  assert.equal(requestUrl.searchParams.get("lang"), "en");
  assert.equal(requestUrl.searchParams.get("mode"), "native");
  assert.equal(result.error, "ENGLISH_CAPTIONS_UNAVAILABLE");
  assert.equal(result.transcript, undefined);
});

test("Overview shares the Transcript batch generation and retries when opened", () => {
  const js = read("sidepanel.js");
  const transcriptFunction = js.match(
    /async function translateTranscript\(\)[\s\S]*?\n}\n\nfunction setTranslatingSpinner/,
  )?.[0];

  assert.ok(transcriptFunction);
  assert.doesNotMatch(transcriptFunction, /translationGeneration \+= 1/);
  assert.match(js, /const TRANSLATION_BATCH_SIZE = 3/);
  assert.match(
    js,
    /const batch = missing\.slice\(start, start \+ TRANSLATION_BATCH_SIZE\)[\s\S]*?rerender\(\);[\s\S]*?await updateCache\(\)/,
  );
  assert.match(
    js,
    /tabName === "overview"[\s\S]*?currentAnalysis[\s\S]*?currentTranscriptMode !== "original"[\s\S]*?translateOverviewContent\(\)/,
  );
  assert.match(
    js,
    /Translate only the visible tab[\s\S]*?tabName === "notes"[\s\S]*?translateNotesContent\(\)/,
  );
  assert.match(
    js,
    /activeTabName === "overview"[\s\S]*?translateOverviewContent\(\)[\s\S]*?activeTabName === "notes"[\s\S]*?translateNotesContent\(\)[\s\S]*?activeTabName === "transcript"[\s\S]*?translateTranscript\(\)/,
  );
});

test("transcript reading position survives a side panel close", async () => {
  const { saveTranscriptViewState, loadTranscriptViewState } =
    loadSidepanelHelpers();

  await saveTranscriptViewState("video-a", 427.5, false);
  const restored = await loadTranscriptViewState("video-a");

  assert.deepEqual(JSON.parse(JSON.stringify(restored)), {
    videoId: "video-a",
    scrollTop: 427.5,
  });

  await saveTranscriptViewState("video-a", 427.5, true);
  assert.equal(await loadTranscriptViewState("video-a"), null);
});

test("selected transcript notes keep exact text and row timestamp", async () => {
  const providerMustNotRun = async () => {
    throw new Error("Selected note must not call a provider");
  };
  const { handleSaveNote } = loadBackgroundHelpers({
    fetchImpl: providerMustNotRun,
  });

  const result = await handleSaveNote(
    "video123",
    92.9,
    "Test video",
    "Test channel",
    "  The selected words stay exact.  ",
  );

  assert.equal(result.success, true);
  assert.equal(result.note.text, "The selected words stay exact.");
  assert.equal(result.note.rawText, "The selected words stay exact.");
  assert.equal(result.note.timestamp, "1:32");
  assert.equal(result.note.timestampSeconds, 92);
  assert.equal(
    result.note.timestampedUrl,
    "https://www.youtube.com/watch?v=video123&t=92s",
  );
});

test("notes at different moments in one caption save different sentences", async () => {
  const transcript = [{
    start: 630,
    duration: 20,
    text: "First, pick up the milk. Then pay at the register. Keep the receipt for later.",
  }];
  const { handleSaveNote } = loadBackgroundHelpers({
    settings: { aiApiKey: "" },
    initialStorage: { digest_video123: { transcript } },
    fetchImpl: async () => { throw new Error("cached transcript should be used"); },
  });
  const first = await handleSaveNote("video123", 632, "Store", "Speaker");
  const second = await handleSaveNote("video123", 645, "Store", "Speaker");
  assert.equal(first.note.text,
    "First, pick up the milk. Context: Then pay at the register. Keep the receipt for later.");
  assert.equal(second.note.text,
    "Keep the receipt for later. Context: First, pick up the milk. Then pay at the register.");
  assert.equal(first.note.rawText, "First, pick up the milk.");
  assert.equal(second.note.rawText, "Keep the receipt for later.");
  assert.notEqual(first.note.text, second.note.text);
});

test("previous notes with repeated cleanup text display their distinct source", async () => {
  const repeated = "An identical expanded note.";
  const { handleGetNotes } = loadBackgroundHelpers({
    initialStorage: { ytd_notes: [
      { videoId: "video123", text: repeated, rawText: "First spoken sentence." },
      { videoId: "video123", text: repeated, rawText: "Second spoken sentence." },
    ] },
  });
  const result = await handleGetNotes("video123");
  assert.equal(result.notes[0].text, "First spoken sentence.");
  assert.equal(result.notes[1].text, "Second spoken sentence.");
});

test("semantic segmentation rebuilds sentences across caption boundaries", () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const segments = groupTranscriptEntries(
    [
      { start: 0, text: "Caption boundaries should" },
      { start: 2, text: "not break a complete sentence." },
      { start: 5, text: "The next thought also" },
      { start: 7, text: "stays together!" },
    ],
    { minChars: 1, idealChars: 100, maxChars: 320, maxSeconds: 20 },
  );
  assert.equal(segments.length, 2);
  assert.equal(
    segments[0].text,
    "Caption boundaries should not break a complete sentence.",
  );
  assert.equal(segments[0].start, 0);
  assert.equal(segments[1].text, "The next thought also stays together!");
  assert.equal(segments[1].start, 5);
});

test("a huge raw Supadata entry is split into seekable bounded segments", () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const text = Array.from({ length: 900 }, (_, index) => `word${index}`).join(" ");
  const segments = groupTranscriptEntries([
    { start: 12, duration: 90, text },
  ]);
  assert.ok(segments.length > 8);
  assert.ok(segments.every((segment) => segment.text.length <= 160));
  assert.equal(segments[0].start, 12);
  assert.ok(segments.at(-1).start > segments[0].start);
  assert.ok(segments.every((segment) => /^segment-\d+-\d+$/.test(segment.id)));
});

test("Chinese sentence and clause punctuation creates semantic guardrails", () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const segments = groupTranscriptEntries(
    [
      { start: 0, text: "这是一个被字幕切开的" },
      { start: 2, text: "完整句子。这是第二个想法，" },
      { start: 5, text: "也应该保持语义完整！" },
    ],
    { minChars: 1, idealChars: 100, maxChars: 320, maxSeconds: 20 },
  );
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "这是一个被字幕切开的完整句子。");
  assert.equal(segments[1].text, "这是第二个想法，也应该保持语义完整！");
});

test("unpunctuated captions stay short without dropping or reordering words", () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const entries = Array.from({ length: 12 }, (_, index) => ({
    start: 355 + index * 2,
    duration: 2,
    text: `these are the spoken words from caption ${index}`,
  }));
  const segments = groupTranscriptEntries(entries);
  assert.ok(segments.length >= 4);
  assert.ok(segments.every(segment => segment.text.length <= 160));
  assert.equal(segments.map(segment => segment.text).join(" "),
    entries.map(entry => entry.text).join(" "));
  segments.forEach(segment => {
    const lastIndex = Number(segment.text.match(/caption (\d+)/g).at(-1).split(" ")[1]);
    assert.ok(entries[lastIndex].start + 2 - segment.start <= 8);
  });
});

test("one long caption splits by time even when its text fits the character limit", () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const text = "had these lovely comments coming through some stories that were told to my mom and we find the book so helpful";
  const segments = groupTranscriptEntries([{ start: 355, duration: 24, text }]);
  assert.ok(segments.length >= 3);
  assert.equal(segments.map(segment => segment.text).join(" "), text);
  segments.forEach(segment => {
    assert.ok(segment.text.length / text.length * 24 <= 8);
  });
  assert.equal(segments[0].start, 355);
  assert.ok(segments.at(-1).start > 370);
});

test("translation cache follows the exact text after transcript regrouping", () => {
  const { transcriptTranslationCacheKey } = loadSidepanelHelpers();
  const original = { id: "segment-0-355000", text: "A long original paragraph." };
  const shorter = { ...original, text: "A long" };
  assert.notEqual(transcriptTranslationCacheKey(original),
    transcriptTranslationCacheKey(shorter));
  assert.match(transcriptTranslationCacheKey(shorter), /semantic-v2:/);
});

test("structured translation batches align by stable ID and expose missing fallback", () => {
  const sidepanel = loadSidepanelHelpers();
  const background = loadBackgroundHelpers();
  const source = [
    { id: "segment-0-0", text: "A complete first sentence." },
    { id: "segment-1-5000", text: "A complete second sentence." },
  ];
  assert.deepEqual(
    JSON.parse(JSON.stringify(background.validateTranscriptBatchRequest({ segments: source }))),
    source,
  );

  const normalized = background.normalizeTranslatedSegmentBatch(
    {
      segments: [
        { id: "unknown", text: "\u5ffd\u7565" },
        { id: "segment-1-5000", text: "\u7b2c\u4e8c\u4e2a\u5b8c\u6574\u53e5\u5b50\u3002" },
      ],
    },
    source,
  );
  const aligned = sidepanel.alignTranslatedSegmentBatch(
    source,
    normalized.segments,
  );
  assert.equal(aligned[0].id, source[0].id);
  assert.equal(aligned[0].text, "");
  assert.match(aligned[0].error, /unavailable/i);
  assert.equal(aligned[1].text, "\u7b2c\u4e8c\u4e2a\u5b8c\u6574\u53e5\u5b50\u3002");
});

test("translated-only omits English while bilingual renders aligned English and Chinese", () => {
  const { renderTranscriptSegmentContent } = loadSidepanelHelpers();
  const segment = { id: "segment-0-0", text: "Original English sentence." };
  const translatedOnly = renderTranscriptSegmentContent(
    segment,
    "zh",
    "\u4e2d\u6587\u8bd1\u6587\u3002",
    "",
  );
  const bilingual = renderTranscriptSegmentContent(
    segment,
    "bilingual",
    "\u4e2d\u6587\u8bd1\u6587\u3002",
    "",
  );
  assert.doesNotMatch(translatedOnly, /Original English sentence/);
  assert.match(translatedOnly, /\u4e2d\u6587\u8bd1\u6587/);
  assert.match(bilingual, /transcript-original/);
  assert.match(bilingual, /Original English sentence/);
  assert.match(bilingual, /\u4e2d\u6587\u8bd1\u6587/);
});

test("subtitle formatting tags render in original and translated segment text", () => {
  const { renderTranscriptSegmentContent } = loadSidepanelHelpers();
  const html = renderTranscriptSegmentContent(
    {
      id: "segment-0-0",
      text: "Think <i>deeply</i>, <b>carefully</b>, and <u>clearly</u>.<br>Next line.",
    },
    "bilingual",
    "\u5b57\u5730<i>\u601d\u8003</i>\u7684\u3002<strong>\u91cd\u70b9</strong>",
    "",
  );

  assert.match(html, /Think <i>deeply<\/i>/);
  assert.match(html, /<b>carefully<\/b>/);
  assert.match(html, /<u>clearly<\/u>\.<br>Next line/);
  assert.match(html, /\u5b57\u5730<i>\u601d\u8003<\/i>\u7684\u3002<strong>\u91cd\u70b9<\/strong>/);
});

test("subtitle markup renderer keeps attributed and arbitrary HTML escaped", () => {
  const { renderSubtitleInlineMarkup } = loadSidepanelHelpers();
  const html = renderSubtitleInlineMarkup(
    '<img src=x onerror="alert(1)"><i onclick="alert(2)">unsafe</i><script>alert(3)</script>',
  );

  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&lt;i onclick=&quot;alert\(2\)&quot;&gt;unsafe<\/i>/);
  assert.match(html, /&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img\b|<i\s+onclick|<script\b/);
});

test("background rejects unsupported language fallthrough and malformed batches", () => {
  const source = read("background.js");
  const { validateTranscriptBatchRequest } = loadBackgroundHelpers();
  assert.match(source, /targetLanguage !== "zh"/);
  assert.match(source, /\["transcriptBatch", "interfaceBatch"\]/);
  assert.throws(
    () => validateTranscriptBatchRequest({ segments: [] }),
    /1 to 4 segments/,
  );
  assert.throws(
    () =>
      validateTranscriptBatchRequest({
        segments: [
          { id: "duplicate", text: "first" },
          { id: "duplicate", text: "second" },
        ],
      }),
    /unique and stable/,
  );
});

test("all AI product requests use DeepSeek non-thinking and JSON behavior", async () => {
  const deepSeekRequests = [];
  const successfulFetch = (requests) => async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "translated" } }],
      }),
    };
  };

  const deepSeek = loadBackgroundHelpers({
    fetchImpl: successfulFetch(deepSeekRequests),
  });
  const deepSeekResult = await deepSeek.requestAiCompletion({
    maxTokens: 128,
    responseFormat: { type: "json_object" },
    messages: [{ role: "user", content: "Hello." }],
  });
  assert.equal(deepSeekResult.text, "translated");
  assert.deepEqual(deepSeekRequests[0].thinking, { type: "disabled" });
  assert.deepEqual(deepSeekRequests[0].response_format, {
    type: "json_object",
  });

  const backgroundSource = read("background.js");
  assert.equal(
    (backgroundSource.match(/await requestAiCompletion\(\{/g) || []).length,
    5,
  );
  assert.doesNotMatch(backgroundSource, /disableThinking/);
  for (const callPath of [
    "handleAnalyzeTranscript",
    "cleanupNoteText",
    "handleExplainSelection",
    "callAiTranslation",
    "handleExtractVocabulary",
  ]) {
    assert.match(
      backgroundSource,
      new RegExp(`async function ${callPath}\\([\\s\\S]*?requestAiCompletion\\(\\{`),
    );
  }
});

test("blank-line chunks reset provider idle timeout and valid JSON succeeds", async () => {
  const timers = createFakeTimers();
  const helpers = loadBackgroundHelpers({
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async () =>
      streamingResponse([
        encode("\n"),
        encode("\n"),
        encode('{"choices":[{"message":{"content":"translated"}}]}'),
      ]),
  });

  const result = await helpers.callAiTranslation("Translate.", "Hello.");
  assert.equal(result.success, true);
  assert.equal(result.text, "translated");
  assert.equal(timers.createdCount(50_000), 5);
  assert.equal(timers.activeCount(50_000), 0);
  assert.equal(timers.activeCount(120_000), 0);
});

test("provider idle silence aborts with a distinct Retry-able error", async () => {
  const timers = createFakeTimers();
  const helpers = loadBackgroundHelpers({
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (_url, { signal }) => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () =>
            new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              });
            }),
        }),
      },
    }),
  });

  const request = helpers.callAiTranslation("Translate.", "Hello.");
  await nextTurn();
  timers.fireActive(50_000);
  const result = await request;
  assert.equal(result.success, false);
  assert.equal(result.code, "AI_IDLE_TIMEOUT");
  assert.match(result.error, /inactive for 50 seconds.*Retry/i);
  assert.equal(timers.activeCount(120_000), 0);
});

test("provider network failures explain likely DNS or filtering causes", async () => {
  const helpers = loadBackgroundHelpers({
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });

  const result = await helpers.callAiTranslation("Translate.", "Hello.");
  assert.equal(result.success, false);
  assert.equal(result.code, "AI_NETWORK_ERROR");
  assert.match(result.error, /securely connect to DeepSeek/i);
  assert.match(result.error, /DNS filter, VPN, firewall, proxy/i);
  assert.doesNotMatch(result.error, /^Failed to fetch$/i);
});

test("blank-line keepalives cannot evade the provider hard cap", async () => {
  const timers = createFakeTimers();
  let releaseRead;
  let signal;
  const helpers = loadBackgroundHelpers({
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () =>
              new Promise((resolve, reject) => {
                releaseRead = () => resolve({ done: false, value: encode("\n") });
                signal.addEventListener("abort", () => {
                  const error = new Error("aborted");
                  error.name = "AbortError";
                  reject(error);
                }, { once: true });
              }),
          }),
        },
      };
    },
  });

  const request = helpers.callAiTranslation("Translate.", "Hello.");
  await nextTurn();
  releaseRead();
  await nextTurn();
  releaseRead();
  await nextTurn();
  assert.equal(timers.activeCount(50_000), 1);
  timers.fireActive(120_000);
  const result = await request;
  assert.equal(result.success, false);
  assert.equal(result.code, "AI_HARD_TIMEOUT");
  assert.match(result.error, /120-second limit.*Retry/i);
  assert.equal(timers.activeCount(50_000), 0);
});

test("provider response reader accepts leading whitespace before JSON", async () => {
  const helpers = loadBackgroundHelpers({
    fetchImpl: async () =>
      streamingResponse([
        encode('  \n\t{"choices":[{"message":{"content":"ok"}}]}'),
      ]),
  });
  const result = await helpers.callAiTranslation("Translate.", "Hello.");
  assert.equal(result.success, true);
  assert.equal(result.text, "ok");
});

test("provider response reader rejects bodies over 2 MiB", async () => {
  const helpers = loadBackgroundHelpers({
    fetchImpl: async () =>
      streamingResponse([new Uint8Array(2 * 1024 * 1024 + 1)]),
  });
  const result = await helpers.callAiTranslation("Translate.", "Hello.");
  assert.equal(result.success, false);
  assert.equal(result.code, "AI_RESPONSE_TOO_LARGE");
  assert.match(result.error, /2 MiB limit/);
});

test("DeepSeek retries one empty transcript JSON response without response_format", async () => {
  const requests = [];
  const helpers = loadBackgroundHelpers({
    fetchImpl: async (url, options) => {
      if (url.startsWith("chrome-extension://")) {
        return { ok: true, text: async () => read("prompts/translation.md") };
      }
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: requests.length === 1
                ? ""
                : '{"segments":[{"id":"segment-0-0","text":"\u4e2d\u6587\u8bd1\u6587\u3002"}]}',
            },
          }],
        }),
      };
    },
  });
  const result = await helpers.handleTranslateContent(
    { segments: [{ id: "segment-0-0", text: "English source sentence." }] },
    "transcriptBatch",
    "zh",
    "Video",
  );
  assert.equal(result.success, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].response_format, { type: "json_object" });
  assert.equal(Object.hasOwn(requests[1], "response_format"), false);
  assert.equal(requests[0].max_tokens, 1536);
});

test("interface batches use the dedicated Overview and Notes translation prompt", async () => {
  const requests = [];
  const helpers = loadBackgroundHelpers({
    fetchImpl: async (url, options) => {
      if (url.startsWith("chrome-extension://")) {
        return { ok: true, text: async () => read("prompts/translation.md") };
      }
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '{"segments":[{"id":"note-1","text":"\u4e2d\u6587\u7b14\u8bb0\u3002"}]}',
            },
          }],
        }),
      };
    },
  });

  const result = await helpers.handleTranslateContent(
    { segments: [{ id: "note-1", text: "Saved note." }] },
    "interfaceBatch",
    "zh",
    "Video",
  );

  assert.equal(result.success, true);
  assert.equal(result.translatedContent.segments[0].text, "\u4e2d\u6587\u7b14\u8bb0\u3002");
  assert.match(
    requests[0].messages[0].content,
    /chapter titles, summaries, quotes, and saved notes/,
  );
});

test("translation message watchdog rejects, clears its timer, and ignores late replies", async () => {
  let timeoutCallback;
  let timeoutDelay;
  let resolveMessage;
  let clearCount = 0;
  const helpers = loadSidepanelHelpers({
    sendMessage: () =>
      new Promise((resolve) => {
        resolveMessage = resolve;
      }),
    setTimeoutImpl(callback, delay) {
      timeoutCallback = callback;
      timeoutDelay = delay;
      return 73;
    },
    clearTimeoutImpl(id) {
      assert.equal(id, 73);
      clearCount += 1;
    },
  });

  const request = helpers.sendTranslationMessage({
    action: "translateContent",
  });
  assert.equal(timeoutDelay, 130_000);
  timeoutCallback();
  await assert.rejects(request, /timed out after 130 seconds.*Retry/i);
  assert.equal(clearCount, 1);

  resolveMessage({ success: true });
  await Promise.resolve();
  assert.equal(clearCount, 1);

  let successTimeoutCallback;
  let successClearCount = 0;
  const successfulHelpers = loadSidepanelHelpers({
    sendMessage: () => Promise.resolve({ success: true }),
    setTimeoutImpl(callback) {
      successTimeoutCallback = callback;
      return 91;
    },
    clearTimeoutImpl(id) {
      assert.equal(id, 91);
      successClearCount += 1;
    },
  });
  assert.deepEqual(
    await successfulHelpers.sendTranslationMessage({
      action: "translateContent",
    }),
    { success: true },
  );
  assert.equal(successClearCount, 1);
  successTimeoutCallback();
  assert.equal(successClearCount, 1);
});

test("Chinese prompt preserves natural bilingual-learning style rules", () => {
  const prompt = read("prompts/translation.md");
  assert.match(prompt, /Translate the complete thought/);
  assert.match(prompt, /Use 你, never 您/);
  assert.match(prompt, /spaces between Chinese and adjacent English words or digits/);
  assert.match(prompt, /source-language `text`/);
});


test("provider rejects wrong and mixed languages", () => {
  const { checkEnglishCaptionResponse, checkCaptionResponse } = loadBackgroundHelpers();
  assert.equal(checkEnglishCaptionResponse({ lang: "es", content: [{ text: "Hola" }] }).error, "ENGLISH_CAPTIONS_UNAVAILABLE");
  assert.equal(checkEnglishCaptionResponse({ lang: "en", content: [{ text: "Bonjour", lang: "fr" }] }).error, "ENGLISH_CAPTIONS_UNAVAILABLE");
  assert.equal(checkCaptionResponse({ lang: "fr-FR", content: [{ text: "Bonjour", lang: "fr" }] }, "fr"), null);
});

test("player captions preserve subsecond timing and skip non-caption events", () => {
  const { parsePlayerTranscript } = loadBackgroundHelpers();
  const result = parsePlayerTranscript({ videoId: "AAAAAAAAAAA", key: "track", source: "youtube-player", language: "en", data: { events: [
    { tStartMs: 0 },
    { tStartMs: 1250, dDurationMs: 1750, segs: [{ utf8: "Hello " }, { utf8: "world\n" }] },
  ] } });
  assert.equal(result.transcript.length, 1);
  assert.equal(result.transcript[0].start, 1.25);
  assert.equal(result.transcript[0].duration, 1.75);
  assert.equal(result.transcriptText, "Hello world");
  assert.equal(result.sourceKey, "track");
  assert.equal(parsePlayerTranscript({ data: { events: [] } }), null);
});

test("native fetch selects the active ASR track and rejects stale identity", async () => {
  let expectedVideo = "AAAAAAAAAAA";
  let requestedKind;
  const tracks = [
    { vssId: ".en", languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?kind=manual" },
    { vssId: "a.en", languageCode: "en", kind: "asr", baseUrl: "https://www.youtube.com/api/timedtext?kind=asr" },
  ];
  const { readPlayerCaptions } = loadBackgroundHelpers({ scripting: {
    executeScript: async ({ func, args }) => {
      const context = vm.createContext({ URL, AbortController, setTimeout: () => 1, clearTimeout() {},
        document: { getElementById: () => ({
          getPlayerResponse: () => ({ videoDetails: { videoId: expectedVideo }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } }),
          getOption: () => ({ vss_id: "a.en", languageCode: "en", kind: "asr" }),
        }) },
        fetch: async (url) => { requestedKind = new URL(url).searchParams.get("kind"); return { ok: true, json: async () => ({ events: [{ tStartMs: 1250, segs: [{ utf8: "Correct track" }] }] }) }; },
      });
      return [{ result: await vm.runInContext(`(${func.toString()})(...${JSON.stringify(args)})`, context) }];
    },
  } });
  const track = await readPlayerCaptions(1, "AAAAAAAAAAA");
  assert.match(track.key, /a.en:asr/);
  const result = await readPlayerCaptions(1, "AAAAAAAAAAA", true, track.key);
  assert.equal(requestedKind, "asr");
  assert.ok(result.data.events.length);
  assert.equal((await readPlayerCaptions(1, "AAAAAAAAAAA", true, "wrong-track")).error, "CAPTION_TRACK_CHANGED");
  expectedVideo = "BBBBBBBBBBB";
  assert.equal(await readPlayerCaptions(1, "AAAAAAAAAAA"), null);
});


test("relay stays on the named tab even when another YouTube tab is active", async () => {
  const sent = [];
  const { handleRelayToContent } = loadBackgroundHelpers({ tabApi: {
    get: async (id) => ({ id, url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" }),
    query: async () => { throw new Error("must not choose another tab"); },
    sendMessage: async (id, payload) => { sent.push({ id, payload }); return { videoId: "AAAAAAAAAAA", currentTime: 12 }; },
  } });
  const result = await handleRelayToContent({ tabId: 101, videoId: "AAAAAAAAAAA", payload: { action: "getCurrentTime" } });
  assert.equal(result.success, true);
  assert.equal(result.tabId, 101);
  assert.equal(sent[0].id, 101);
  assert.equal(sent[0].payload.videoId, "AAAAAAAAAAA");
  assert.equal((await handleRelayToContent({ payload: { action: "getCurrentTime" } })).success, false);
});

test("relay rejects navigation during a pending reply without trying another tab", async () => {
  let url = "https://www.youtube.com/watch?v=AAAAAAAAAAA";
  let sends = 0;
  const { handleRelayToContent } = loadBackgroundHelpers({ tabApi: {
    get: async () => ({ url }),
    query: async () => { throw new Error("no fallback allowed"); },
    sendMessage: async () => { sends++; url = "https://www.youtube.com/watch?v=BBBBBBBBBBB"; return { videoId: "AAAAAAAAAAA", currentTime: 8 }; },
  } });
  assert.equal((await handleRelayToContent({ tabId: 101, videoId: "AAAAAAAAAAA", payload: { action: "getCurrentTime" } })).success, false);
  assert.equal(sends, 1);
  assert.equal((await handleRelayToContent({ tabId: 101, videoId: "AAAAAAAAAAA", payload: { action: "getCurrentTime" } })).success, false);
  assert.equal(sends, 1);
});

test("canonical player metadata retains video identity", async () => {
  const { handleRelayToContent } = loadBackgroundHelpers({ tabApi: {
    get: async () => ({ url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" }),
    sendMessage: async () => ({ videoId: "AAAAAAAAAAA", title: "DOM title" }),
  }, scripting: { executeScript: async () => [{ result: { videoId: "AAAAAAAAAAA", title: "Player title" } }] } });
  const result = await handleRelayToContent({ tabId: 101, videoId: "AAAAAAAAAAA", payload: { action: "getVideoInfo" } });
  assert.equal(result.response.videoId, "AAAAAAAAAAA");
  assert.equal(result.response.title, "Player title");
});


test("panel and Reader honor saved language defaults on every video open", async () => {
  const initialStorage = { ytd_settings: { defaultTranscriptMode: "zh", defaultReaderMode: "original" } };
  const panel = loadSidepanelHelpers({ initialStorage });
  const reader = loadSidepanelHelpers({ initialStorage, reader: true });
  assert.equal(await panel.loadDisplayLanguageMode("first-video"), "zh");
  assert.equal(await reader.loadDisplayLanguageMode("first-video"), "original");
  initialStorage.ytd_settings.defaultTranscriptMode = "original";
  initialStorage.ytd_settings.defaultReaderMode = "bilingual";
  assert.equal(await panel.loadDisplayLanguageMode("another-video"), "original");
  assert.equal(await reader.loadDisplayLanguageMode("another-video"), "bilingual");
  initialStorage.ytd_settings.defaultTranscriptMode = "invalid";
  initialStorage.ytd_settings.defaultReaderMode = "invalid";
  assert.equal(await panel.loadDisplayLanguageMode("another-video"), "bilingual");
  assert.equal(await reader.loadDisplayLanguageMode("another-video"), "original");
});

test('the Li Lu sentence stays intact across the 3:58 and 4:04 captions', () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const first = 'So, today I want to dedicate an episode to describing how Li Lu views the issue of China’s middle-income trap and how he';
  const last = 'analyzes the problem of how China can overcome it.';
  const next = 'First, as everyone knows, since 2021 the economic situation in China over the last few years has not been particularly good.';
  const segments = groupTranscriptEntries([
    { start: 238, duration: 6, text: first },
    { start: 244, duration: 4, text: last },
    { start: 248, duration: 7, text: next },
  ]);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, `${first} ${last}`);
  assert.ok(segments[0].text.length > 160);
  assert.equal(segments[0].start, 238);
  assert.equal(segments[1].text, next);
  assert.equal(segments.map(segment => segment.text).join(' '), `${first} ${last} ${next}`);
});

test('complete long sentences keep every word even beyond the old time and length limits', () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const text = Array.from({ length: 100 }, (_, index) => `word${index}`).join(' ') + '.';
  const segments = groupTranscriptEntries([{ start: 10, duration: 45, text }]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, text);
  assert.equal(segments[0].start, 10);
  const chinese = '这是一段需要完整保留的中文句子'.repeat(20) + '。';
  assert.equal(groupTranscriptEntries([{ start: 0, duration: 40, text: chinese }])[0].text, chinese);
});
