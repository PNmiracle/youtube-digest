const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../transcript-export');
const original = 'A fine example is fine.';
const mark = (from, to, extra = {}) => ({ start: 1.25, lane: 'original', from, to, quote: original.slice(from, to), ...extra });
const make = highlights => build({ title: 'Example', url: 'https://example.com', segments: [{ start: 1.25, original, translation: '一个好例子。' }, { start: 4, original: 'More context.' }], highlights });
test('exports full context and only the highlighted occurrence, with every target in prompt', () => {
  const text = make([mark(18, 22)]);
  assert.match(text, /A fine example is \[\[fine\]\]\./);
  assert.match(text, /1\. \[0:01\] \(original\) fine/);
  assert.match(text, /More context\./);
  assert.match(text, /do not skip any/);
  assert.doesNotMatch(text, /Translation:/);
});
test('overlapping and duplicate marks merge; adjacent phrases stay separate', () => {
  const text = make([mark(2, 6), mark(2, 6), mark(2, 10), mark(10, 13)]);
  assert.match(text, /HIGHLIGHT TARGETS \(2\)/);
  assert.match(text, /A \[\[fine exa\]\]\[\[mpl\]\]e is fine\./);
});
test('translation highlights keep original context and unknown anchors are reported', () => {
  const text = make([{ start: 1.25, lane: 'translation', from: 2, to: 3, quote: '好' }, { start: 1.25, lane: 'original', from: 0, to: 7, quote: 'missing' }]);
  assert.match(text, /Translation: 一个\[\[好\]\]例子。/);
  assert.match(text, /A fine example is fine\./);
  assert.match(text, /UNMATCHED SAVED HIGHLIGHTS \(1\)/);
  assert.match(text, /\(original\) missing/);
});
test('regrouped unique quotes migrate, ambiguous stale offsets do not guess', () => {
  const text = make([mark(0, 4, { start: 2, quote: 'example' }), mark(0, 4, { quote: 'fine' })]);
  assert.match(text, /fine \[\[example\]\] is fine/);
  assert.match(text, /UNMATCHED SAVED HIGHLIGHTS \(1\)/);
});
test('no highlights exports readable full transcript with an explicit empty state', () => {
  assert.match(make([]), /No highlights matched/);
  assert.match(make([]), /\[0:04\] More context\./);
});
test('French export teaches French pronunciation rather than American English IPA', () => {
  const text=build({language:'fr-CA',segments:[{start:0,original:'Bonjour.'}],highlights:[{start:0,lane:'original',from:0,to:7,quote:'Bonjour'}]});
  assert.match(text,/French IPA/);
  assert.match(text,/liaison/);
  assert.doesNotMatch(text,/American English IPA/);
  assert.ok(text.indexOf('VOCABULARY STUDY REQUEST')>text.indexOf('END OF TRANSCRIPT'));
});
