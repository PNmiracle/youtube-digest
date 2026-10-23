const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "sidepanel.js"), "utf8");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createPanel() {
  const requests = new Map();
  const saved = [];
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        style: {},
        classList: { toggle() {} },
        innerHTML: "",
        textContent: "",
      });
    }
    return nodes.get(id);
  };
  const events = { addListener() {} };
  let activationListener;
  const sandbox = vm.createContext({
    console,
    URL,
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    document: {
      addEventListener() {},
      getElementById: node,
      querySelectorAll() { return []; },
    },
    window: { close() {} },
    chrome: {
      runtime: {
        onMessage: events,
        sendMessage(message) {
          if (message.action === "getCaptionTrack") return Promise.resolve(null);
          const request = deferred();
          requests.set(`${message.action}:${message.videoId || ""}`, request);
          return request.promise;
        },
      },
      tabs: { onUpdated: events, onActivated: { addListener(fn) { activationListener = fn; } } },
      windows: { getCurrent: async () => ({ id: 1 }) },
      storage: { local: {
        get: async () => ({}),
        set: async (value) => saved.push(value),
        remove: async () => {},
      } },
    },
  });
  vm.runInContext(source, sandbox);
  vm.runInContext(`
    loadTranscriptViewState = async () => null;
    loadDisplayLanguageMode = async () => "original";
    switchTab = () => {};
    renderTranscript = () => {};
    showState = () => {};
    updateLoading = () => {};
    restorePendingTranscriptViewState = () => {};
    loadNotes = () => {};
    setupExplainFeature = () => {};
    resultTabIsActive = () => false;
    evictOldCacheEntries = async () => {};
  `, sandbox);
  return { sandbox, requests, saved, nodes, activate: (args) => activationListener(args) };
}

async function waitForRequest(requests, key) {
  for (let i = 0; i < 20 && !requests.has(key); i += 1) {
    await Promise.resolve();
  }
  assert.ok(requests.has(key), `request ${key} was sent`);
}

test("late transcript response cannot replace the next video's transcript or cache", async () => {
  const panel = createPanel();
  const a = "AAAAAAAAAAA";
  const b = "BBBBBBBBBBB";
  const first = vm.runInContext(`startDigest("${a}", "https://www.youtube.com/watch?v=${a}")`, panel.sandbox);
  await waitForRequest(panel.requests, `fetchTranscript:${a}`);
  const second = vm.runInContext(`startDigest("${b}", "https://www.youtube.com/watch?v=${b}")`, panel.sandbox);
  await waitForRequest(panel.requests, `fetchTranscript:${b}`);

  panel.requests.get(`fetchTranscript:${b}`).resolve({
    success: true,
    transcript: [{ start: 0, text: "Video B" }],
    transcriptText: "Video B",
    transcriptTextTimestamped: "[0:00] Video B",
  });
  await second;
  panel.requests.get(`fetchTranscript:${a}`).resolve({
    success: true,
    transcript: [{ start: 0, text: "Video A" }],
    transcriptText: "Video A",
    transcriptTextTimestamped: "[0:00] Video A",
  });
  await first;

  assert.equal(vm.runInContext("currentVideoId", panel.sandbox), b);
  assert.equal(vm.runInContext("currentTranscriptText", panel.sandbox), "Video B");
  assert.equal(panel.saved.length, 1);
  assert.equal(panel.saved[0][`digest_${b}`].transcriptText, "Video B");
});

test("legacy cache without video identity is refetched", async () => {
  const panel = createPanel();
  const videoId = "BBBBBBBBBBB";
  panel.sandbox.chrome.storage.local.get = async () => ({
    [`digest_${videoId}`]: { transcriptText: "wrong video", timestamp: Date.now() },
  });
  let removed;
  panel.sandbox.chrome.storage.local.remove = async (key) => { removed = key; };
  const result = await vm.runInContext(`loadFromCache("${videoId}")`, panel.sandbox);
  assert.equal(result, null);
  assert.equal(removed, `digest_${videoId}`);
});

test("cached transcript from before language validation is refetched", async () => {
  const panel = createPanel();
  const videoId = "BBBBBBBBBBB";
  panel.sandbox.chrome.storage.local.get = async () => ({
    [`digest_${videoId}`]: {
      videoId,
      transcriptText: "Chinese fallback from an older release",
      transcriptLanguage: "zh",
      timestamp: Date.now(),
    },
  });
  let removed;
  panel.sandbox.chrome.storage.local.remove = async (key) => { removed = key; };
  const result = await vm.runInContext(`loadFromCache("${videoId}")`, panel.sandbox);
  assert.equal(result, null);
  assert.equal(removed, `digest_${videoId}`);
});

test("late Overview response cannot appear under the next video", async () => {
  const panel = createPanel();
  vm.runInContext(`
    currentVideoId = "AAAAAAAAAAA";
    currentTranscriptTimestamped = "[0:00] Video A";
    currentTranscript = [{ start: 0, text: "Video A" }];
    renderAnalysisResults = () => { throw new Error("stale Overview rendered"); };
    highlightMomentsOnPage = () => {};
  `, panel.sandbox);
  const analysis = vm.runInContext("triggerAnalysis()", panel.sandbox);
  await waitForRequest(panel.requests, "analyzeTranscript:");
  vm.runInContext(`digestGeneration += 1; currentVideoId = "BBBBBBBBBBB"; currentAnalysis = null;`, panel.sandbox);
  panel.requests.get("analyzeTranscript:").resolve({
    success: true,
    analysis: { chapters: [{ title: "Video A" }] },
  });
  await analysis;
  assert.equal(vm.runInContext("currentAnalysis", panel.sandbox), null);
  assert.equal(panel.saved.length, 0);
});


test("cache from another same-language caption track is discarded", async () => {
  const panel = createPanel();
  const videoId = "AAAAAAAAAAA";
  const version = vm.runInContext("TRANSCRIPT_CACHE_VERSION", panel.sandbox);
  panel.sandbox.chrome.storage.local.get = async () => ({
    [`digest_${videoId}`]: { videoId, transcriptCacheVersion: version, transcriptSourceKey: "manual", timestamp: Date.now() },
  });
  assert.equal(await vm.runInContext(`loadFromCache("${videoId}", "asr")`, panel.sandbox), null);
});

test("Refresh bypasses cache and analysis and rejects the old response", async () => {
  const panel = createPanel();
  const videoId = "AAAAAAAAAAA";
  let removed;
  panel.sandbox.chrome.storage.local.remove = async (key) => { removed = key; };
  vm.runInContext(`stopPlaybackTracking = () => {}; resetTranscriptSearch = () => {};`, panel.sandbox);
  const first = vm.runInContext(`startDigest("${videoId}", "https://www.youtube.com/watch?v=${videoId}")`, panel.sandbox);
  await waitForRequest(panel.requests, `fetchTranscript:${videoId}`);
  const oldRequest = panel.requests.get(`fetchTranscript:${videoId}`);
  vm.runInContext(`currentAnalysis = { chapters: [] }; transcriptParagraphCache.set("${videoId}:old", "old translation");`, panel.sandbox);
  const refreshing = vm.runInContext("refreshTranscript()", panel.sandbox);
  for (let i = 0; i < 30 && panel.requests.get(`fetchTranscript:${videoId}`) === oldRequest; i++) await Promise.resolve();
  const newRequest = panel.requests.get(`fetchTranscript:${videoId}`);
  assert.notEqual(newRequest, oldRequest);
  assert.equal(removed, `digest_${videoId}`);
  newRequest.resolve({ success: true, transcript: [{ text: "Fresh captions", start: 1.25 }], transcriptText: "Fresh captions", transcriptTextTimestamped: "[0:01] Fresh captions" });
  await refreshing;
  oldRequest.resolve({ success: true, transcript: [{ text: "Old captions", start: 0 }], transcriptText: "Old captions" });
  await first;
  assert.equal(vm.runInContext("currentTranscriptText", panel.sandbox), "Fresh captions");
  assert.equal(vm.runInContext("currentAnalysis", panel.sandbox), null);
  assert.equal(vm.runInContext("transcriptParagraphCache.size", panel.sandbox), 0);
  assert.equal(panel.nodes.get("refreshTranscriptBtn").disabled, false);
  assert.equal(panel.saved.length, 1);
});

test("reusing the same video and track preserves an in-flight Overview generation", async () => {
  const panel = createPanel();
  vm.runInContext(`currentVideoId = "AAAAAAAAAAA"; currentTranscript = [{ text: "Loaded", start: 0 }]; isAnalysisLoading = true; digestGeneration = 7;`, panel.sandbox);
  await vm.runInContext(`startDigest("AAAAAAAAAAA", "https://www.youtube.com/watch?v=AAAAAAAAAAA")`, panel.sandbox);
  assert.equal(vm.runInContext("digestGeneration", panel.sandbox), 7);
  assert.equal(vm.runInContext("isAnalysisLoading", panel.sandbox), true);
  assert.equal(panel.requests.size, 0);
});


test("late playback time from tab A cannot move tab B's transcript", async () => {
  const panel = createPanel();
  vm.runInContext(`youtubeTabId = 101; currentVideoId = "AAAAAAAAAAA"; highlightActiveEntry = () => { throw new Error("stale playback highlighted"); };`, panel.sandbox);
  const tick = vm.runInContext("playbackTrackingTick()", panel.sandbox);
  await waitForRequest(panel.requests, "relayToContent:AAAAAAAAAAA");
  vm.runInContext(`youtubeTabId = 202; currentVideoId = "BBBBBBBBBBB"; digestGeneration++;`, panel.sandbox);
  panel.requests.get("relayToContent:AAAAAAAAAAA").resolve({ success: true, tabId: 101, response: { videoId: "AAAAAAAAAAA", currentTime: 60 } });
  await tick;
});

test("playback time is requested and applied only for the panel's bound video tab", async () => {
  const panel = createPanel();
  let sent, highlighted;
  panel.sandbox.chrome.runtime.sendMessage = async (message) => { sent = message; return { success: true, tabId: 101, response: { videoId: "AAAAAAAAAAA", currentTime: 12.5 } }; };
  panel.sandbox.recordHighlight = (seconds) => { highlighted = seconds; };
  vm.runInContext(`youtubeTabId = 101; currentVideoId = "AAAAAAAAAAA"; highlightActiveEntry = recordHighlight;`, panel.sandbox);
  await vm.runInContext("playbackTrackingTick()", panel.sandbox);
  assert.equal(sent.tabId, 101);
  assert.equal(sent.videoId, "AAAAAAAAAAA");
  assert.equal(highlighted, 12.5);
});

test("switching tabs invalidates pending work before asynchronous lookup finishes", async () => {
  const panel = createPanel();
  const lookup = deferred();
  panel.sandbox.chrome.tabs.get = () => lookup.promise;
  vm.runInContext(`youtubeTabId = 101; currentVideoId = "AAAAAAAAAAA"; stopPlaybackTracking = () => {};`, panel.sandbox);
  const before = vm.runInContext("digestGeneration", panel.sandbox);
  const activation = panel.activate({ tabId: 202, windowId: 1 });
  assert.ok(vm.runInContext("digestGeneration", panel.sandbox) > before);
  assert.equal(vm.runInContext("youtubeTabId", panel.sandbox), null);
  lookup.resolve({ url: "https://www.youtube.com/watch?v=BBBBBBBBBBB" });
  await activation;
});

test("video detection queries the panel's own window and binds metadata to its tab", async () => {
  const panel = createPanel();
  let query, message, loadedTab;
  panel.sandbox.chrome.tabs.query = async (value) => { query = value; return [{ id: 101, url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" }]; };
  panel.sandbox.chrome.runtime.sendMessage = async (value) => { message = value; return { success: true, response: { videoId: "AAAAAAAAAAA", title: "Video A" } }; };
  panel.sandbox.recordStart = (id, url, options) => { loadedTab = options.tabId; };
  vm.runInContext("panelWindowId = 1; startDigest = recordStart;", panel.sandbox);
  await vm.runInContext("checkCurrentTab()", panel.sandbox);
  assert.equal(query.windowId, 1);
  assert.equal(query.lastFocusedWindow, undefined);
  assert.equal(message.tabId, 101);
  assert.equal(message.videoId, "AAAAAAAAAAA");
  assert.equal(loadedTab, 101);
});
