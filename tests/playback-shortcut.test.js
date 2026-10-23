const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("D shows Transcript from inside the Digest panel", () => {
  const source = read("sidepanel.js");
  const handler = source.match(
    /function handleDigestShortcut\(event\) \{[\s\S]*?\n\}\n(?=\nfunction handleSentenceShortcut)/,
  )?.[0];
  assert.ok(handler);
  assert.match(source, /addEventListener\("keydown", handleDigestShortcut\)/);

  const tabs = [];
  const context = vm.createContext({ switchTab: (name) => tabs.push(name) });
  vm.runInContext(handler, context);
  let prevented = 0;
  const event = {
    key: "D",
    target: { closest: () => null },
    preventDefault() { prevented += 1; },
    stopPropagation() {},
  };
  context.handleDigestShortcut(event);
  context.handleDigestShortcut({ ...event, target: { closest: () => ({}) } });
  context.handleDigestShortcut({ ...event, ctrlKey: true });
  context.handleDigestShortcut({ ...event, repeat: true });
  assert.deepEqual(tabs, ["transcript"]);
  assert.equal(prevented, 1);
});

test("Space in the side panel controls playback without scrolling or activating a button", async () => {
  const source = read("sidepanel.js");
  const handler = source.match(
    /function handlePlaybackSpacebar\(event\) \{[\s\S]*?\n\}\n(?=\nfunction handleSentenceShortcut)/,
  )?.[0];
  assert.ok(handler);

  const messages = [];
  const context = vm.createContext({
    currentVideoId: "video-a",
    youtubeTabId: 23,
    chrome: {
      tabs: {
        async sendMessage(tabId, message) {
          messages.push({ tabId, message });
        },
      },
    },
    console,
  });
  vm.runInContext(handler, context);

  let prevented = 0;
  const event = {
    code: "Space",
    key: " ",
    target: { closest: () => null },
    preventDefault() { prevented += 1; },
    stopPropagation() {},
  };
  context.handlePlaybackSpacebar(event);
  await Promise.resolve();
  assert.equal(prevented, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { tabId: 23, message: { action: "togglePlayback" } },
  ]);

  context.handlePlaybackSpacebar({ ...event, target: { closest: () => ({}) } });
  context.handlePlaybackSpacebar({ ...event, ctrlKey: true });
  context.handlePlaybackSpacebar({ ...event, repeat: true });
  assert.equal(messages.length, 1);
});

test("bracket shortcuts choose adjacent sentence starts and play them", async () => {
  const source = read("sidepanel.js");
  const helpers = source.match(
    /function adjacentSentenceStart\(starts, currentTime, direction\) \{[\s\S]*?\n\}\n(?=\nasync function seekTo)/,
  )?.[0];
  assert.ok(helpers);

  const messages = [];
  const context = vm.createContext({
    currentVideoId: "video-a",
    youtubeTabId: 23,
    digestGeneration: 1,
    currentTranscript: [{ start: 0 }, { start: 5.5 }, { start: 11 }],
    TRANSCRIPT_SEGMENT_LIMITS: { minChars: 60, idealChars: 180 },
    groupTranscriptEntries(entries, limits) {
      assert.equal(limits.minChars, 0);
      assert.equal(limits.idealChars, Infinity);
      return entries;
    },
    chrome: {
      tabs: {
        async sendMessage(tabId, message) {
          messages.push({ tabId, message });
          if (message.action === "getCurrentTime") {
            return { currentTime: 6, videoId: "video-a" };
          }
          return { success: true };
        },
      },
    },
  });
  vm.runInContext(helpers, context);

  assert.equal(context.adjacentSentenceStart([0, 5.5, 11], 6, "previous"), 0);
  assert.equal(context.adjacentSentenceStart([0, 5.5, 11], 6, "next"), 11);
  assert.equal(context.adjacentSentenceStart([0, 5.5, 11], 0, "previous"), null);
  assert.equal(context.adjacentSentenceStart([0, 5.5, 11], 11, "next"), null);

  const result = await context.navigateTranscriptSentence("next", "video-a");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, seconds: 11 });
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { tabId: 23, message: { action: "getCurrentTime" } },
    { tabId: 23, message: { action: "seekTo", seconds: 11, videoId: "video-a" } },
  ]);

  const stale = await context.navigateTranscriptSentence("previous", "video-b");
  assert.equal(stale.success, false);
  assert.equal(messages.length, 2);
});

test("sentence shortcuts split short sentences that share one visible row", () => {
  const source = read("sidepanel.js");
  const grouping = source.match(
    /const TRANSCRIPT_SEGMENT_LIMITS = Object\.freeze\([\s\S]*?\n\}\n(?=\n\/\/ ============================================================\n\/\/ INITIALIZATION)/,
  )?.[0];
  assert.ok(grouping);
  const context = vm.createContext({});
  vm.runInContext(grouping, context);
  const starts = vm.runInContext(`
    groupTranscriptEntries(
      [{ start: 0, duration: 8, text: "Hello. Goodbye." }],
      { ...TRANSCRIPT_SEGMENT_LIMITS, minChars: 0, idealChars: Infinity },
    ).map((entry) => entry.start)
  `, context);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] > starts[0]);
});

test("backslash resumes transcript following immediately without stealing typed input", () => {
  const source = read("sidepanel.js");
  const handlers = source.match(
    /function handleFollowShortcut\(event\) \{[\s\S]*?\n\}\n(?=\nfunction setNotesFilter)/,
  )?.[0];
  assert.ok(handlers);

  const followButton = { style: { display: "block" } };
  let scrolls = 0;
  let ticks = 0;
  let saves = 0;
  let prevented = 0;
  const context = vm.createContext({
    currentVideoId: "video-a",
    currentTranscript: [{ start: 0 }],
    autoScrollEnabled: false,
    transcriptTabIsActive: () => true,
    document: { getElementById: () => followButton },
    scrollToActiveEntry() { scrolls += 1; },
    playbackTrackingTick() { ticks += 1; },
    saveCurrentTranscriptViewState() { saves += 1; },
  });
  vm.runInContext(handlers, context);

  const event = {
    key: "\\",
    target: { closest: () => null },
    preventDefault() { prevented += 1; },
    stopPropagation() {},
  };
  context.handleFollowShortcut(event);
  assert.equal(prevented, 1);
  assert.equal(context.autoScrollEnabled, true);
  assert.equal(followButton.style.display, "none");
  assert.equal(scrolls, 1);
  assert.equal(ticks, 1);
  assert.equal(saves, 1);

  context.handleFollowShortcut({ ...event, target: { closest: () => ({}) } });
  context.handleFollowShortcut({ ...event, shiftKey: true });
  assert.equal(scrolls, 1);

  let scheduledFollow;
  let switchedTo;
  context.transcriptTabIsActive = () => false;
  context.switchTab = (name) => { switchedTo = name; };
  context.requestAnimationFrame = (callback) => { scheduledFollow = callback; };
  context.resumePlaybackFollowing();
  assert.equal(switchedTo, "transcript");
  assert.equal(scrolls, 1);
  scheduledFollow();
  assert.equal(scrolls, 2);
});

test("the content script toggles the actual YouTube video element", () => {
  let listener;
  let plays = 0;
  let pauses = 0;
  const video = {
    paused: false,
    pause() { pauses += 1; this.paused = true; },
    play() { plays += 1; this.paused = false; return Promise.resolve(); },
  };
  const context = vm.createContext({
    console,
    document: {
      readyState: "loading",
      addEventListener() {},
      querySelector: () => video,
    },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
  });
  vm.runInContext(read("content.js"), context);

  const responses = [];
  listener({ action: "togglePlayback" }, {}, (response) => responses.push(response));
  listener({ action: "togglePlayback" }, {}, (response) => responses.push(response));
  assert.equal(pauses, 1);
  assert.equal(plays, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(responses)), [
    { success: true },
    { success: true },
  ]);
});
