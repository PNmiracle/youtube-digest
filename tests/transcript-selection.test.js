const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "sidepanel.js"),
  "utf8",
);

test("replay button and right-click seek without using ordinary transcript clicks", () => {
  assert.doesNotMatch(source, /seekFromTranscriptEntryClick/);
  assert.match(source, /setupTranscriptReplay\(div, group\.start\)/);
  assert.match(source, /setupTranscriptReplay\(div, segment\.start\)/);
  const vm=require('node:vm');
  const helper=source.slice(source.indexOf('function setupTranscriptReplay('),source.indexOf('function transcriptWordBounds('));
  let clicked, rightClicked, sought, cleared;
  const context={currentTranscriptSource:"youtube-player",seekTo:seconds=>{sought=seconds;},dismissSelectionActions:flag=>{cleared=flag;}};
  vm.createContext(context);vm.runInContext(helper,context);
  context.setupTranscriptReplay({addEventListener:(name, fn)=>{assert.equal(name,"contextmenu");rightClicked=fn;},querySelector:selector=>{
    assert.equal(selector,'.transcript-replay-btn');
    return {addEventListener:(name,fn)=>{assert.equal(name,'click');clicked=fn;}};
  }},48.25);
  assert.equal(sought,undefined);
  clicked({preventDefault(){},stopPropagation(){}});
  assert.equal(sought,48.25);assert.equal(cleared,true);
  sought=undefined;cleared=false;
  let prevented=false,stopped=false;
  rightClicked({preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(sought,48.25);assert.equal(cleared,true);
  assert.equal(prevented,true);assert.equal(stopped,true);
  sought=undefined;context.currentTranscriptSource="academy-lesson-text";
  rightClicked({preventDefault(){throw new Error("Written lessons retain their context menu");}});
  assert.equal(sought,undefined);

});

test("the selection toolbar preserves selection and contains pointer events", () => {
  assert.match(
    source,
    /class="explain-btn"[\s\S]*?>Explain<[\s\S]*class="selection-note-btn"[\s\S]*?>Highlight</,
  );
  assert.match(
    source,
    /tooltip\.addEventListener\("mousedown", \(event\) => \{\s+event\.preventDefault\(\);\s+event\.stopPropagation\(\);/,
  );
  assert.match(
    source,
    /tooltip\.addEventListener\("mouseup", \(event\) => \{\s+event\.stopPropagation\(\);/,
  );
  assert.match(
    source,
    /\.addEventListener\("click", async \(event\) => \{\s+event\.preventDefault\(\);\s+event\.stopPropagation\(\);/,
  );
  assert.match(
    source,
    /querySelector\("\.selection-note-btn"\)[\s\S]*ytd_manual_highlights:[\s\S]*chrome\.storage\.local\.set/,
  );
  assert.match(
    source,
    /tooltip\.style\.top =[\s\S]*tooltip\.style\.left =[\s\S]*tooltip\.style\.display = "flex"/,
    "the toolbar must be positioned before it becomes visible",
  );
});

test("leaving Transcript dismisses its selection actions", () => {
  assert.match(
    source,
    /if \(tabName !== "transcript" && transcriptTabIsActive\(\)\) \{\s*captureCurrentTranscriptScrollTop\(\);\s*dismissSelectionActions\(true\);/,
  );
  assert.match(
    source,
    /function dismissSelectionActions\(clearSelection = false\)[\s\S]*tooltip\.style\.display = "none"[\s\S]*window\.getSelection\(\)\?\.removeAllRanges\(\)/,
  );
});

test("Notes opens at its newest item and Transcript keeps its position", () => {
  assert.match(
    source,
    /if \(tabName === "notes"\)[\s\S]*notesPanelIsActive[\s\S]*contentArea\.scrollTop = 0/,
  );
  assert.match(
    source,
    /if \(tabName === "transcript"\)[\s\S]*contentArea\.scrollTop = lastTranscriptScrollTop/,
  );
});

test("opening a video follows playback instead of restoring a paused reading position", () => {
  assert.match(
    source,
    /void saveCurrentTranscriptViewState\(\);\s+window\.close\(\);/,
  );
  assert.match(
    source,
    /pendingTranscriptViewState = null;[\s\S]*currentTranscriptMode = await loadDisplayLanguageMode\(videoId\);[\s\S]*switchTab\("transcript"\)/,
  );
  assert.match(
    source,
    /function restorePendingTranscriptViewState\(videoId\)[\s\S]*autoScrollEnabled = false;[\s\S]*contentArea\.scrollTop = state\.scrollTop;/,
  );
  assert.match(
    source,
    /willRestoreReadingPosition[\s\S]*autoScrollEnabled = autoScrollEnabled && !willRestoreReadingPosition/,
  );
  assert.match(
    source,
    /function scheduleTranscriptViewStateSave\(\)[\s\S]*!transcriptTabIsActive\(\)[\s\S]*return;/,
  );
  assert.match(
    source,
    /tabName !== "transcript" && transcriptTabIsActive\(\)[\s\S]*captureCurrentTranscriptScrollTop\(\)/,
  );
});

test("the first non-YouTube navigation is checked again after commit", () => {
  assert.match(
    source,
    /function getNavigationUrl\(changeInfo, tab\)[\s\S]*changeInfo\.status !== "loading"[\s\S]*changeInfo\.status !== "complete"[\s\S]*tab\.pendingUrl \|\| tab\.url/,
  );
  assert.match(
    source,
    /chrome\.tabs\.onUpdated\.addListener\(\(tabId, changeInfo, tab\)[\s\S]*getNavigationUrl\(changeInfo, tab\)[\s\S]*handleFrontTabUrl\(url\)/,
  );
});

test("the panel never borrows a background YouTube tab", () => {
  assert.match(
    source,
    /const tabs = window\.digestReader[\s\S]*?resolveSourceTab\(\)[\s\S]*?: await chrome\.tabs\.query\(\{ active: true, windowId \}\);/,
  );
  assert.match(
    source,
    /if \(!tab\.url\.startsWith\("https:\/\/www\.youtube\.com"\) && !extractVideoId\(tab\.url\)\?\.startsWith\("academy:"\) && !extractVideoId\(tab\.url\)\?\.startsWith\("descript:"\)\) \{\s*handleFrontTabUrl\(tab\.url\);\s*return;/,
  );
  assert.doesNotMatch(
    source,
    /chrome\.tabs\.query\(\{ url: "https:\/\/www\.youtube\.com\/\*" \}\)/,
  );
});
