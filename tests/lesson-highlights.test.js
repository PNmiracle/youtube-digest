const test = require('node:test');
const assert = require('node:assert/strict');
const {locate} = require('../lesson-highlights.js');
const {createStore} = require('../lesson-highlight-store.js');
const sender = {url:'https://langchain-ai.github.io/lca-lessons/deepagents/m1/m1.5-tools.html',tab:{id:1}};
const sample = {quote:'tools',prefix:'',suffix:'',color:'yellow'};
function memoryStorage() {
  const data = {};
  return {get:async key=>({[key]:data[key]}),set:async values=>Object.assign(data,values)};
}
test('trusted storage bridge saves, reads and removes without content-script storage access',async () => {
  const store = createStore(memoryStorage(),()=> 'test-id');
  const added = await store.handle({action:'addLessonHighlight',item:sample},sender);
  assert.equal(added.items.length,1);
  assert.equal((await store.handle({action:'getLessonHighlights'},sender)).items[0].quote,'tools');
  assert.equal((await store.handle({action:'removeLessonHighlight',id:'test-id'},sender)).items.length,0);
});
test('bridge rejects spoofed page origins and invalid payloads',async () => {
  const store = createStore(memoryStorage());
  await assert.rejects(store.handle({action:'getLessonHighlights'},{...sender,url:'https://example.com/lca-lessons/a'}));
  await assert.rejects(store.handle({action:'addLessonHighlight',item:{...sample,color:'invalid'}},sender));
});
test('concurrent additions retain both entries and keep lessons separate',async () => {
  let id=0;
  const store = createStore(memoryStorage(),()=>String(++id));
  await Promise.all([
    store.handle({action:'addLessonHighlight',item:sample},sender),
    store.handle({action:'addLessonHighlight',item:{...sample,quote:'agent'}},sender)
  ]);
  assert.equal((await store.handle({action:'getLessonHighlights'},sender)).items.length,2);
  assert.equal((await store.handle({action:'getLessonHighlights'},{...sender,url:sender.url.replace('m1.5','m1.6')})).items.length,0);
});
test('content-script highlights use messages while trusted storage protection remains',()=> {
  const fs = require('node:fs');
  assert.doesNotMatch(fs.readFileSync(require.resolve('../lesson-highlights.js'),'utf8'),/chrome\.storage\.local/);
  assert.match(fs.readFileSync(require.resolve('../background.js'),'utf8'),/setAccessLevel\(\{ accessLevel: "TRUSTED_CONTEXTS" \}\)/);
});
test('restore the intended occurrence after content is inserted before it', () => {
  const saved = {quote:'tools',prefix:'Second: ',suffix:' execute.'};
  assert.deepEqual(locate('New content. First: tools retrieve. Second: tools execute.',saved),{start:44,end:49});
});
test('do not restore onto another repeated phrase after its context changes', () => {
  assert.equal(locate('First: tools retrieve. Third: tools execute.',{quote:'tools',prefix:'Second: ',suffix:' execute.'}),null);
});
test('ambiguous or deleted quotations are not highlighted', () => {
  assert.equal(locate('tools tools',{quote:'tools'}),null);
  assert.equal(locate('tools',{quote:'missing'}),null);
  assert.equal(locate('tools',{quote:''}),null);
});
test('lesson highlighter is no longer injected into pages', () => {
  const manifest = require('../manifest.json');
  assert.equal(manifest.content_scripts.some(x => x.js.includes('lesson-highlights.js')),false);
  const fs = require('node:fs');
  assert.doesNotMatch(fs.readFileSync(require.resolve('../background.js'),'utf8'),/lessonHighlightStore/);
});
