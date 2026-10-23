const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../sidepanel.js'), 'utf8');
const follow = source.match(/function gentlyFollowEntry\(entry\) \{[\s\S]*?\n\}/)[0];
const handler = source.match(/function highlightActiveEntry\(currentSeconds\) \{[\s\S]*?\n\}/)[0];
function fixture() {
  let scrolls = 0, now = 10000;
  const content = {getBoundingClientRect: () => ({top:100,bottom:700,height:600}), scrollBy() {scrolls++;}};
  const entries = [3.58, 4.04, 8.15].map(seconds => {
    const classes = new Set();
    return { dataset: {seconds: String(seconds)},
      classList: {contains: name => classes.has(name), toggle(name, on) {on ? classes.add(name) : classes.delete(name);}},
      top: 350,
      getBoundingClientRect() {return {top:this.top};}
    };
  });
  const context = vm.createContext({Date:{now:()=>now}, document: {getElementById: id => id === 'contentArea' ? content : ({querySelectorAll: () => entries})}, autoScrollEnabled: false, autoScrollLocked: false, lastAutoScrollTime: 0});
  vm.runInContext(follow + "\n" + handler, context);
  return {context, entries, advance: ms => {now += ms;}, tick: time => context.highlightActiveEntry(time), state: () => entries.map(e => ['playback-read', 'active-playback'].filter(c => e.classList.contains(c)).join(',')), scrolls: () => scrolls};
}
test('playback fades only prior sentences, respects fractional starts, and reverses on seeking', () => {
  const f = fixture();
  f.tick(0); assert.deepEqual(f.state(), ['', '', '']);
  f.tick(4); assert.deepEqual(f.state(), ['active-playback', '', '']);
  f.tick(4.04); assert.deepEqual(f.state(), ['playback-read', 'active-playback', '']);
  f.tick(9); assert.deepEqual(f.state(), ['playback-read', 'playback-read', 'active-playback']);
  f.tick(3.6); assert.deepEqual(f.state(), ['active-playback', '', '']);
  f.tick(0); assert.deepEqual(f.state(), ['', '', '']);
  assert.equal(f.scrolls(), 0);
});
test('visible sentences stay still even when follow lock polls repeatedly', () => {
  const f = fixture(); f.context.autoScrollEnabled = true; f.context.autoScrollLocked = true;
  f.tick(4); f.tick(4.1); f.tick(5); f.tick(9);
  assert.equal(f.scrolls(), 0);
});
test('follow moves near an edge and waits four seconds between movements', () => {
  const f = fixture(); f.context.autoScrollLocked = true;
  f.entries[1].top = 650;
  f.tick(4.1); assert.equal(f.scrolls(), 1);
  f.tick(5); assert.equal(f.scrolls(), 1);
  f.advance(3999); f.tick(5); assert.equal(f.scrolls(), 1);
  f.advance(1); f.tick(5); assert.equal(f.scrolls(), 2);
  f.entries[2].top = 90;
  f.advance(4000); f.tick(9); assert.equal(f.scrolls(), 3);
});
test('turning follow off prevents scrolling even outside the viewport', () => {
  const f = fixture(); f.entries[1].top = 900;
  f.tick(5); assert.equal(f.scrolls(), 0);
});
