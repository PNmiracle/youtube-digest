const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('descript-native.js','utf8');
function helpers() {const context=vm.createContext({});vm.runInContext(source,context);return context.__YTD_NATIVE_TESTING__;}
test('Native integration keeps existing word nodes and maps phrases across them',()=>{
  const {nativeTranscriptWords,nativeVocabularyMatches}=helpers();
  const nodes=['a','model','provider','hosts','models'].map(text=>({textContent:text}));
  const words=nativeTranscriptWords({querySelectorAll:()=>nodes});
  assert.equal(words[1].node,nodes[1]);
  const text=words.map(word=>word.text).join(' ');
  const matches=nativeVocabularyMatches(text,[{id:'provider',term:'provider'},{id:'phrase',term:'model provider'},{id:'model',term:'model'}]);
  assert.equal(matches.length,1);assert.equal(matches[0].entry.id,'phrase');
  assert.deepEqual(Array.from(words.filter(word=>word.start<matches[0].end && word.end>matches[0].start),word=>word.text),['model','provider']);
});
test('Native Chinese alignment matches within sentences and protects English word boundaries',()=>{
  const {nativeVocabularyMatches}=helpers();
  assert.equal(nativeVocabularyMatches('模型提供商托管模型',[{id:'provider',term:'模型提供商'}])[0].start,0);
  assert.equal(nativeVocabularyMatches('models',[{term:'model'}]).length,0);
});
test('Native transcript integration preserves Descript timing and uses shared Digest actions',()=>{
  assert.doesNotMatch(source,/word\.node\.(?:innerHTML|outerHTML|textContent)\s*=/);
  assert.match(source,/data-current-word/);
  assert.match(source,/event\.stopImmediatePropagation\(\)/);
  assert.match(source,/action:'explainSelection'/);
  assert.match(source,/action:'alignVocabularyTranslation'/);
  assert.match(source,/action:'saveVocabulary'/);
  assert.match(source,/ytd_manual_highlights:/);
  const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
  assert.ok(manifest.content_scripts.some(entry=>entry.js.includes('descript-native.js') && entry.matches.includes('https://share.descript.com/view/*')));
});
