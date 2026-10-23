const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function load(reply = () => ({ entries: [] })) {
  const data = {};
  let calls = 0;
  const sandbox = {
    chrome: { storage: { local: {
      get: async key => structuredClone({ [key]: data[key] }),
      set: async values => Object.assign(data, structuredClone(values)),
    } } },
    requestAiCompletion: async request => {
      calls++;
      assert.match(request.messages[0].content, /IELTS 7\.0/);
      assert.match(request.messages[0].content, /American English IPA/);
      return { text: JSON.stringify(await reply(request, calls)) };
    },
    parseLooseJson: JSON.parse,
  };
  const source = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  vm.runInNewContext(fs.readFileSync(path.join(root, 'vocabulary-context.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'vocabulary-learning.js'), 'utf8'), sandbox);
  vm.runInNewContext(source.slice(source.indexOf('const VOCABULARY_STORAGE_KEY'), source.indexOf('async function handleExplainSelection')), sandbox);
  return { sandbox, data, calls: () => calls };
}
const item = term => ({ term, ipa: '/təˈstiː/', meaningEn: 'A useful meaning', meaningZh: '中文释义', usage: 'Use in context.' });
const message = (videoId = 'video-one') => ({ videoId, videoTitle: 'Lesson', segments: [{ start: 5, text: 'This is nuanced. We need to take into account the context.' }] });

test('keeps original sentence and timestamps, including phrases across captions', () => {
  const { sandbox } = load();
  const segments = [{ start: 1, text: 'Introduction.' }, { start: 22, text: 'We should take into' }, { start: 25, text: 'account the nuance. Next topic.' }];
  const result = sandbox.groundVocabularyCandidate(item('take into account'), segments);
  assert.equal(result.context, 'We should take into account the nuance.');
  assert.equal(result.timestampSeconds, 22);
  assert.equal(result.kind, 'phrase');
  assert.equal(result.ipa, '/təˈstiː/');
  assert.equal(result.meaningZh, '中文释义');
});

test('rejects invented terms, substrings and missing bilingual or IPA fields', () => {
  const { sandbox } = load();
  const segments = [{ text: 'Agents need nuanced reasoning.', start: 0 }];
  assert.equal(sandbox.groundVocabularyCandidate(item('agent'), segments), null);
  assert.equal(sandbox.groundVocabularyCandidate(item('invented'), segments), null);
  assert.equal(sandbox.groundVocabularyCandidate({ term: 'nuanced' }, segments), null);
});

test('deduplicates concurrent scans, caches successes, and accumulates across videos', async () => {
  const { sandbox, data, calls } = load(() => ({ entries: [item('nuanced'), item('take into account')] }));
  await Promise.all([sandbox.handleExtractVocabulary(message()), sandbox.handleExtractVocabulary(message())]);
  assert.equal(calls(), 1);
  assert.equal(data.ytd_vocabulary.length, 2);
  await sandbox.handleExtractVocabulary(message());
  assert.equal(calls(), 1);
  await sandbox.handleExtractVocabulary(message('video-two'));
  assert.equal(calls(), 2);
  assert.equal(data.ytd_vocabulary.length, 2);
  assert.equal(data.ytd_vocabulary[0].seenCount, 2);
});

test('retries failures without falsely caching them or deleting manual entries', async () => {
  const { sandbox, data, calls } = load((_request, count) => {
    if (count === 1) throw new Error('Provider unavailable');
    return { entries: [item('nuanced')] };
  });
  await sandbox.queueVocabularyMutation(() => sandbox.handleSaveVocabulary({ term: 'my phrase', context: 'My original text.' }));
  await assert.rejects(sandbox.handleExtractVocabulary(message()), /Provider unavailable/);
  await sandbox.handleExtractVocabulary(message());
  assert.equal(calls(), 2);
  assert.equal(data.ytd_vocabulary.length, 2);
  assert.equal(data.ytd_vocabulary.find(entry => entry.term === 'my phrase').context, 'My original text.');
});

test('serialized manual writes avoid lost entries and enrichment preserves mastery', async () => {
  const { sandbox, data } = load();
  await Promise.all(['nuanced', 'subtle'].map(term => sandbox.queueVocabularyMutation(() => sandbox.handleSaveVocabulary({ term }))));
  assert.equal(data.ytd_vocabulary.length, 2);
  data.ytd_vocabulary.find(entry => entry.term === 'nuanced').mastered = true;
  await sandbox.queueVocabularyMutation(() => sandbox.handleSaveVocabulary({ ...item('nuanced'), sourceKey: 'source-one' }));
  await sandbox.queueVocabularyMutation(() => sandbox.handleSaveVocabulary({ ...item('nuanced'), sourceKey: 'source-one' }));
  const saved = data.ytd_vocabulary.find(entry => entry.term === 'nuanced');
  assert.equal(saved.mastered, true);
  assert.equal(saved.seenCount, 2);
  assert.equal(saved.ipa, '/təˈstiː/');
});

test('covers long transcripts in bounded chunks and resumes a partially completed scan', async () => {
  const { sandbox, calls, data } = load((_request, count) => {
    if (count === 2) throw new Error('Second chunk failed');
    return { entries: [item('nuanced')] };
  });
  const segments = [{ start: 1, text: 'nuanced ' + 'a'.repeat(1590) }, { start: 200, text: 'A nuanced ending.' }];
  const chunks = sandbox.vocabularyChunks(segments, 1600);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every(chunk => chunk.reduce((sum, row) => sum + row.text.length, 0) <= 1600));
  await assert.rejects(sandbox.handleExtractVocabulary({ ...message(), segments }), /Second chunk/);
  await sandbox.handleExtractVocabulary({ ...message(), segments });
  assert.equal(calls(), 3);
  assert.equal(data.ytd_vocabulary[0].seenCount, 1);
});

test('automatic selection supplies learner history and refuses mastered terms even if AI returns them', async () => {
  const { sandbox, data } = load(request => {
    const input = JSON.parse(request.messages[1].content);
    assert.deepEqual(input.masteredTerms, ['nuanced']);
    assert.equal(input.learnerProfile.known[0].term, 'nuanced');
    return { entries: [item('nuanced'), item('take into account')] };
  });
  await sandbox.queueVocabularyMutation(() => sandbox.handleSaveVocabulary({ term: 'nuanced' }));
  data.ytd_vocabulary[0].mastered = true;
  await sandbox.handleExtractVocabulary(message());
  assert.equal(data.ytd_vocabulary.find(entry => entry.term === 'nuanced').seenCount, 1);
  assert.equal(data.ytd_vocabulary.find(entry => entry.term === 'nuanced').mastered, true);
  assert.ok(data.ytd_vocabulary.find(entry => entry.term === 'take into account'));
});

test('saves all qualifying entries without the former sixteen-entry cutoff', async () => {
  const terms = Array.from({ length: 25 }, (_, index) => `advanced${index}`);
  const { sandbox, data } = load(request => {
    assert.match(request.messages[0].content, /Inspect EVERY distinct English word/);
    assert.match(request.messages[0].content, /NO top-N limit/);
    return { entries: terms.map(item) };
  });
  const result = await sandbox.handleExtractVocabulary({ ...message(), segments: [{ start: 12, text: terms.join(' ') + '.' }] });
  assert.equal(result.added, 25);
  assert.equal(data.ytd_vocabulary.length, 25);
  assert.ok(data.ytd_vocabulary.some(entry => entry.term === 'advanced24'));
});

test('incomplete entries do not silently mark a scan complete', async () => {
  const { sandbox, data, calls } = load((_request, count) => ({ entries: count === 1 ? [{ term: 'nuanced' }] : [item('nuanced')] }));
  await assert.rejects(sandbox.handleExtractVocabulary(message()), /not marked complete/);
  await sandbox.handleExtractVocabulary(message());
  assert.equal(calls(), 2);
  assert.equal(data.ytd_vocabulary.length, 1);
});

test('automatically splits truncated output and preserves full original sentences', async () => {
  const { sandbox, data } = load();
  let count = 0;
  sandbox.requestAiCompletion = async request => {
    count++;
    if (count === 1) return { text: '{"entries":[]}', finishReason: 'length' };
    return { text: JSON.stringify({ entries: JSON.parse(request.messages[1].content).transcript.includes('nuanced') ? [item('nuanced')] : [] }), finishReason: 'stop' };
  };
  const sentence = 'This nuanced explanation includes ' + 'context '.repeat(35) + 'and ends here.';
  await sandbox.handleExtractVocabulary({ ...message(), segments: [{ start: 4, text: sentence }] });
  assert.equal(count, 3);
  assert.equal(data.ytd_vocabulary.length, 1);
  assert.equal(data.ytd_vocabulary[0].context, sentence);
});

test('shared vocabulary keeps each video sentence and timestamp without duplicating the term', async () => {
  const { sandbox, data } = load();
  await sandbox.handleSaveVocabulary({ ...item('nuanced'), videoId: 'first', context: 'First nuanced sentence.', timestampSeconds: 12 });
  await sandbox.handleSaveVocabulary({ ...item('nuanced'), videoId: 'second', context: 'Second nuanced sentence.', timestampSeconds: 55 });
  assert.equal(data.ytd_vocabulary.length, 1);
  const saved = data.ytd_vocabulary[0];
  assert.equal(saved.occurrences.length, 2);
  assert.equal(saved.occurrences[1].context, 'Second nuanced sentence.');
  assert.equal(saved.occurrences[1].timestampSeconds, 55);
  await sandbox.handleSaveVocabulary({ ...item('nuanced'), videoId: 'second', context: 'Second nuanced sentence.', timestampSeconds: 55 });
  assert.equal(data.ytd_vocabulary[0].occurrences.length, 2);
});

test('a later extraction chunk grounds repeated words in that chunk, with full sentences', async () => {
  const { sandbox, data } = load(request => {
    const transcript = JSON.parse(request.messages[1].content).transcript;
    return { entries: transcript.includes('nuanced') ? [{ ...item('nuanced'), sourceSentence: 'A fabricated nuanced example.' }] : [] };
  });
  const segments = [
    { start: 1, text: 'A nuanced opening. ' + 'padding '.repeat(195) + '.' },
    { start: 60, text: 'A different nuanced ending.' },
  ];
  await sandbox.handleExtractVocabulary({ ...message(), segments });
  assert.equal(data.ytd_vocabulary[0].context, 'A different nuanced ending.');
  assert.equal(data.ytd_vocabulary[0].timestampSeconds, 60);
  assert.equal(data.ytd_vocabulary[0].occurrences[0].timestampSeconds, 60);
});

test('repairs stale contexts when mastery invalidates extraction caches, preserving mastery and encounter counts', async () => {
  const { sandbox, data, calls } = load(() => ({ entries: [item('nuanced')] }));
  await sandbox.handleExtractVocabulary(message());
  const saved = data.ytd_vocabulary[0];
  saved.context = saved.occurrences[0].context = 'Wrong original sentence.';
  saved.timestampSeconds = saved.occurrences[0].timestampSeconds = 99;
  saved.mastered = true;
  await sandbox.handleExtractVocabulary(message());
  assert.equal(calls(), 2);
  assert.equal(data.ytd_vocabulary[0].context, 'This is nuanced.');
  assert.equal(data.ytd_vocabulary[0].occurrences[0].context, 'This is nuanced.');
  assert.equal(data.ytd_vocabulary[0].timestampSeconds, 5);
  assert.equal(data.ytd_vocabulary[0].mastered, true);
  assert.equal(data.ytd_vocabulary[0].seenCount, 1);
});

test('unpunctuated ASR does not attach the same long paragraph to every term', () => {
  const { sandbox } = load();
  const segments = [
    { start: 1, text: 'opening '.repeat(100) },
    { start: 40, text: 'We take into' },
    { start: 42, text: 'account the context' },
    { start: 60, text: 'ending '.repeat(100) },
  ];
  const result = sandbox.groundVocabularyCandidate(item('take into account'), segments);
  assert.equal(result.context, 'We take into account the context');
  assert.equal(result.timestampSeconds, 40);
});

test('a shared term retains the meaning belonging to each video sentence', async () => {
  const { sandbox, data } = load();
  await sandbox.handleSaveVocabulary({ ...item('trace'), automatic: true, videoId: 'first', context: 'No trace remained.', meaningZh: '痕迹' });
  await sandbox.handleSaveVocabulary({ ...item('trace'), automatic: true, videoId: 'second', context: 'Inspect the agent trace.', meaningZh: '执行追踪' });
  assert.equal(data.ytd_vocabulary[0].meaningZh, '痕迹');
  assert.equal(data.ytd_vocabulary[0].occurrences[1].meaningZh, '执行追踪');
  assert.equal(data.ytd_vocabulary[0].occurrences[1].context, 'Inspect the agent trace.');
});

test('mastery feedback invalidates scans, removes familiar suggestions, and retains saved cards', async () => {
  const { sandbox, data, calls } = load(request => {
    const input = JSON.parse(request.messages[1].content);
    assert.match(request.messages[0].content, /precision matters more than quantity/);
    return { entries: input.masteredTerms.includes('nuanced')
      ? [{ ...item('take into account'), priority: 3, recommendationReason: 'A useful academic collocation.' }]
      : [item('nuanced')] };
  });
  await sandbox.handleExtractVocabulary(message());
  data.ytd_vocabulary.find(entry => entry.term === 'nuanced').mastered = true;
  await sandbox.handleExtractVocabulary(message());
  assert.equal(calls(), 2);
  assert.equal(data.ytd_vocabulary.length, 2);
  assert.equal(data.ytd_vocabulary.find(entry => entry.term === 'nuanced').seenCount, 1);
  assert.equal(data.ytd_vocabulary.find(entry => entry.term === 'take into account').priority, 3);
  await sandbox.handleExtractVocabulary(message());
  assert.equal(calls(), 2);
});

test('a tutor can stop recommending an old basic entry without deleting it', async () => {
  const { sandbox, data } = load(() => ({ entries: [item('nuanced')] }));
  await sandbox.handleSaveVocabulary({ ...item('context'), automatic: true, videoId: 'video-one', context: 'We need to take into account the context.' });
  await sandbox.handleExtractVocabulary(message());
  const basic = data.ytd_vocabulary.find(entry => entry.term === 'context');
  assert.equal(basic.recommended, false);
  assert.equal(basic.occurrences[0].recommended, false);
  assert.equal(data.ytd_vocabulary.length, 2);
});

test('mastery changed during an AI request cannot commit stale recommendations or cache the scan', async () => {
  const { sandbox, data, calls } = load(() => {
    data.ytd_vocabulary[0].mastered = true;
    return { entries: [item('nuanced')] };
  });
  await sandbox.handleSaveVocabulary({ ...item('nuanced'), automatic: true, videoId: 'video-one' });
  const first = await sandbox.handleExtractVocabulary(message());
  assert.equal(first.profileStale, true);
  assert.equal(Object.keys(data).filter(key => key.startsWith('vocab_scan_')).length, 0);
  const second = await sandbox.handleExtractVocabulary(message());
  assert.equal(second.profileStale, false);
  assert.equal(calls(), 2);
  assert.equal(data.ytd_vocabulary[0].seenCount, 1);
});

test('learning profile does not assume unmarked AI cards are unknown and ranks stably', () => {
  const { sandbox } = load();
  const entries = [
    { term: 'known', automatic: true, mastered: true },
    { term: 'suggested', automatic: true, priority: 1 },
    { term: 'manually saved', automatic: false, manualSaved: true, priority: 3 },
    { term: 'practice again', automatic: true, studyAgainAt: 1, priority: 3 },
  ];
  const learner = sandbox.YTD_VOCABULARY_LEARNING.profile(entries);
  assert.deepEqual(Array.from(learner.known, entry => entry.term), ['known']);
  assert.deepEqual(Array.from(learner.needsPractice, entry => entry.term), ['practice again', 'manually saved']);
  assert.deepEqual(Array.from(sandbox.YTD_VOCABULARY_LEARNING.rank(entries), entry => entry.term), ['manually saved', 'practice again', 'known', 'suggested']);
  assert.equal(entries[0].term, 'known');
});

test('precision filtering excludes plain basic words, code names and arbitrary clauses', async () => {
  const { sandbox, data } = load(() => ({ entries: [
    item('act'), item('system'), item('create_deep_agent'),
    item('agent decides when to call them'), item('nuanced'),
  ] }));
  await sandbox.handleExtractVocabulary({ ...message(), segments: [{ start: 1, text: 'The system can act. The agent decides when to call them. Use create_deep_agent for nuanced reasoning.' }] });
  assert.deepEqual(data.ytd_vocabulary.map(entry => entry.term), ['nuanced']);
});

test('legacy saved entries are not automatically treated as explicit knowledge gaps', () => {
  const { sandbox } = load();
  const learner = sandbox.YTD_VOCABULARY_LEARNING.profile([{ term: 'system', automatic: false }]);
  assert.equal(learner.needsPractice.length, 0);
  assert.equal(sandbox.YTD_VOCABULARY_LEARNING.recommended({ term: 'system', recommended: false }), false);
});
