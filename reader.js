/* Full-page reading surface. Reuses Digest's transcript, translation and vocabulary pipeline. */
(() => {
  const isFullReader = location.pathname.endsWith('/reader.html');
  const params = new URLSearchParams(location.search);
  if (isFullReader) window.digestReader = {
    async resolveSourceTab() {
      const source = params.get('url');
      if (!extractVideoId(source)) throw new Error('Open Reader from a video’s Digest panel.');
      const matches = tab => tab?.url && extractVideoId(tab.url) === extractVideoId(source);
      const id = Number(params.get('tabId'));
      if (Number.isInteger(id) && id > 0) {
        try { const tab = await chrome.tabs.get(id); if (matches(tab)) return tab; } catch (_) { /* Find another matching tab. */ }
      }
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(matches);
      if (!tab) throw new Error('Open the original video or lesson in another tab, then reload Reader.');
      return tab;
    },
  };

  const colors = ['#ffb3a7', '#fff59a', '#a7e8c9', '#f5b9d4', '#c9b9f4'];
  let color = 0, quick = false, erasing = false, highlightsVisible = false, records = [], loadedVideo = null, undo = [], queue = Promise.resolve();
  let fontSize = isFullReader ? 28 : 16, width = 900;
  window.digestHighlighter = { get enabled() { return quick; }, get mode() { return !quick ? 'off' : erasing ? 'erase' : 'highlight'; }, whenIdle: () => queue };
  const key = () => `ytd_reader_highlights:${currentVideoId}`;
  const roots = () => [...document.querySelectorAll('#transcriptList .transcript-entry')]
    .flatMap(row => {
      const localized = [...row.querySelectorAll('.transcript-original, .transcript-translation:not(.translation-pending):not(.translation-error)')];
      return localized.length ? localized : [...row.querySelectorAll('.transcript-text')];
    });
  const lane = root => root.classList.contains('transcript-translation') ? 'translation' : 'original';
  const rowStart = root => Number(root.closest('.transcript-entry').dataset.seconds);
  const status = text => {
    const node = document.getElementById('readerStatus');
    node.title = text;
    node.textContent = text.startsWith('Could not') ? 'Save failed'
      : text.includes('saved') || text === 'Highlight saved' ? 'Saved'
      : text.startsWith('Quick highlight on') ? 'Pen on'
      : text.startsWith('Quick highlight off') ? 'Pen off'
      : text.startsWith('Eraser on') ? 'Eraser on' : text;
  };

  // Character offsets are scoped to a timestamp and language; duplicate words stay independent.
  function selectedParts() {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return [];
    const range = selection.getRangeAt(0);
    const list = document.getElementById('transcriptList');
    if (!list.contains(range.startContainer) || !list.contains(range.endContainer)) return [];
    return roots().flatMap(root => {
      if (!range.intersectsNode(root)) return [];
      const before = document.createRange();
      before.selectNodeContents(root);
      let from = 0, to = root.textContent.length;
      if (root.contains(range.startContainer)) { before.setEnd(range.startContainer, range.startOffset); from = before.toString().length; }
      if (root.contains(range.endContainer)) { before.selectNodeContents(root); before.setEnd(range.endContainer, range.endOffset); to = before.toString().length; }
      const quote = root.textContent.slice(from, to);
      return quote.trim() ? [{ start: rowStart(root), lane: lane(root), from, to, quote }] : [];
    });
  }

  function rangeFor(root, item) {
    if (root.textContent.slice(item.from, item.to) !== item.quote) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let offset = 0, node, start = null, end = null;
    while ((node = walker.nextNode())) {
      const next = offset + node.length;
      if (!start && item.from >= offset && item.from < next) start = [node, item.from - offset];
      if (item.to > offset && item.to <= next) { end = [node, item.to - offset]; break; }
      offset = next;
    }
    if (!start || !end) return null;
    const range = document.createRange(); range.setStart(...start); range.setEnd(...end); return range;
  }

  function layoutBookParagraphs() {
    if (!isFullReader) return;
    const list = document.getElementById('transcriptList');
    const entries = [...list.querySelectorAll(':scope > .transcript-entry')];
    if (!entries.length) return;
    let paragraph = null, words = 0;
    for (const entry of entries) {
      if (!paragraph) {
        paragraph = document.createElement('p');
        paragraph.className = 'reader-paragraph';
        list.insertBefore(paragraph, entry);
      }
      if (paragraph.childNodes.length) paragraph.appendChild(document.createTextNode(' '));
      paragraph.appendChild(entry);
      const text = entry.querySelector('.transcript-original')?.textContent || entry.querySelector('.transcript-text')?.textContent || '';
      words += text.trim().split(/\s+/).length;
      // Break only at sentence boundaries so each paragraph reads naturally.
      if (words >= 90 && /[.!?]["'”’)]?\s*$/.test(text)) { paragraph = null; words = 0; }
    }
  }

  async function paint() {
    if (!currentVideoId) return;
    layoutBookParagraphs();
    if (loadedVideo !== currentVideoId) {
      const video = currentVideoId;
      const stored = (await chrome.storage.local.get(key()))[key()];
      if (video !== currentVideoId) return;
      records = Array.isArray(stored) ? stored.filter(item => colors[item.color] && Number.isInteger(item.from) && item.to > item.from && typeof item.quote === 'string') : [];
      loadedVideo = video; undo = [];
    }
    if (!CSS.highlights) { status('This browser does not support reader highlighting.'); return; }
    const textRoots = roots();
    let migrated = false;
    for (const item of records) {
      const candidates = textRoots.filter(root => lane(root) === item.lane);
      const root = candidates.find((root, index) => rowStart(root) <= item.start &&
        (index === candidates.length - 1 || rowStart(candidates[index + 1]) > item.start));
      if (!root || (rowStart(root) === item.start && rangeFor(root, item))) continue;
      const from = root.textContent.indexOf(item.quote);
      // Only migrate an unambiguous quote inside the sentence containing its old timestamp.
      if (from < 0 || root.textContent.indexOf(item.quote, from + 1) >= 0) continue;
      Object.assign(item, { start: rowStart(root), from, to: from + item.quote.length });
      migrated = true;
    }
    if (migrated) await chrome.storage.local.set({ [key()]: records });
    const ranges = colors.map(() => []);
    for (const root of textRoots) {
      for (const item of records.filter(item => highlightsVisible && item.start === rowStart(root) && item.lane === lane(root))) {
        const range = rangeFor(root, item); if (range) ranges[item.color].push(range);
      }
    }
    colors.forEach((_, index) => CSS.highlights.set(`reader-${index}`, new Highlight(...ranges[index])));
  }

  function change(action) {
    // Capture before awaiting storage; toolbar clicks preserve the native selection.
    const parts = selectedParts(), video = currentVideoId, selectedColor = color;
    if (parts.length || action === 'undo') highlightsVisible = true;
    queue = queue.then(async () => {
      await paint();
      if (!video || video !== currentVideoId) return;
      const previous = records.map(item => ({ ...item }));
      if (action === 'undo') {
        if (!undo.length) return;
        records = undo.pop();
      } else {
        if (!parts.length) { status('Select a word or phrase in the transcript first.'); return; }
        undo.push(previous);
        if (action === 'erase') {
          for (const part of parts) records = records.flatMap(item => {
            if (part.start !== item.start || part.lane !== item.lane || part.from >= item.to || part.to <= item.from) return [item];
            const remaining = [];
            if (part.from > item.from) remaining.push({ ...item, to: part.from, quote: item.quote.slice(0, part.from - item.from) });
            if (part.to < item.to) remaining.push({ ...item, from: part.to, quote: item.quote.slice(part.to - item.from) });
            return remaining;
          });
        } else records = records.filter(item => !parts.some(part => part.start === item.start && part.lane === item.lane && part.from < item.to && part.to > item.from));
        if (action === 'highlight') records.push(...parts.map(part => ({ ...part, color: selectedColor })));
      }
      try {
        await chrome.storage.local.set({ [key()]: records });
      } catch (error) { records = previous; throw error; }
      await paint();
      getSelection()?.removeAllRanges();
      dismissSelectionActions();
      status(action === 'undo' ? 'Undone · saved' : action === 'erase' ? 'Highlight removed · saved' : 'Highlight saved');
    }).catch(error => { status(`Could not save: ${error.message}`); });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    document.body.classList.toggle('full-reader', isFullReader);
    const tools = document.createElement('aside');
    tools.className = 'reader-tools'; tools.setAttribute('aria-label', 'Highlight controls');
    tools.innerHTML = `<div class="reader-type"><button id="readerSmaller" title="Smaller text (Option/Alt+−)" aria-label="Smaller text" aria-keyshortcuts="Alt+-">A−</button><output id="readerFontSize" aria-live="polite" title="Reset size: Option/Alt+0"></output><button id="readerLarger" title="Larger text (Option/Alt++)" aria-label="Larger text" aria-keyshortcuts="Alt+=">A+</button><button id="readerWidth" title="Toggle reading width">↔</button></div>
      <div class="reader-palette" role="toolbar" aria-label="Highlight colors"><button id="readerQuick" aria-pressed="false" title="Continuous highlighting (Option+Q or Option+Shift+H)" aria-keyshortcuts="Alt+Q Alt+Shift+H">✎ Auto</button>${colors.map((value,index) => `<button class="reader-color" data-color="${index}" style="--swatch:${value}" title="Highlight color ${index + 1} (select text, then ${index + 1})" aria-label="Highlight color ${index + 1}" aria-pressed="${index === 0}">${index + 1}</button>`).join('')}<button id="readerHighlight" title="Highlight selection (H)">Mark</button><button id="readerErase" aria-pressed="false" title="橡皮：开启后连续划选，擦除选中文字的高亮">橡皮</button><button id="readerUndo" title="Undo last highlight edit (⌘/Ctrl+Z)">Undo</button></div><div id="readerStatus" role="status" title="Option+Q: continuous highlighting · W: save vocabulary">Ready</div>`;
    document.body.appendChild(tools);
    const followButton = document.getElementById('followPlaybackBtn');
    if (followButton) {
      tools.prepend(followButton);
      followButton.textContent = 'Follow';
      followButton.title = 'Follow playback';
      followButton.setAttribute('aria-label', 'Follow playback');
    }
    const palette = tools.querySelector('.reader-palette');
    tools.insertBefore(document.getElementById('readerStatus'), palette);
    palette.hidden = true;
    tools.addEventListener('mousedown', event => event.preventDefault());
    tools.addEventListener('mouseup', event => event.stopPropagation());
    const storedPrefs = (await chrome.storage.local.get('ytd_reader_preferences')).ytd_reader_preferences;
    const prefs = storedPrefs && typeof storedPrefs === 'object' ? storedPrefs : {};
    const sizeKey = isFullReader ? 'fontSize' : 'panelFontSize';
    const defaultSize = isFullReader ? 28 : 16;
    fontSize = Math.min(44, Math.max(12, Number(prefs[sizeKey]) || defaultSize));
    width = prefs?.width === 1180 ? 1180 : 900;
    const applySize = () => {
      document.documentElement.style.setProperty('--reader-size', `${fontSize}px`);
      document.documentElement.style.setProperty('--reader-width', `${width}px`);
      document.getElementById('readerFontSize').textContent = `${fontSize}px`;
    };
    applySize();
    const saveSize = () => {
      applySize(); Object.assign(prefs, { [sizeKey]: fontSize, width });
      void chrome.storage.local.set({ ytd_reader_preferences: prefs })
        .catch(error => status(`Could not save text size: ${error.message}`));
    };
    const resize = delta => { fontSize = Math.min(44, Math.max(12, fontSize + delta)); saveSize(); };
    document.getElementById('readerSmaller').onclick = () => resize(-2);
    document.getElementById('readerLarger').onclick = () => resize(2);
    document.getElementById('readerWidth').onclick = () => { width = width === 1180 ? 900 : 1180; saveSize(); };
    const selectColor = index => {
      color = index;
      tools.querySelectorAll('[data-color]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.color) === color)));
    };
    tools.querySelectorAll('[data-color]').forEach(button => button.onclick = () => { selectColor(Number(button.dataset.color)); if (selectedParts().length) change('highlight'); });
    document.getElementById('readerHighlight').onclick = () => change('highlight');
    document.getElementById('readerUndo').onclick = () => change('undo');
    const setMode = mode => {
      quick = mode !== 'off';
      erasing = mode === 'erase';
      const penOn = quick && !erasing;
      palette.hidden = !quick;
      if (quick) highlightsVisible = true;
      void paint();
      document.getElementById('readerQuick').setAttribute('aria-pressed', String(penOn));
      document.getElementById('readerQuick').textContent = penOn ? '✎ On' : '✎ Auto';
      document.getElementById('readerErase').setAttribute('aria-pressed', String(erasing));
      const headerToggle = document.getElementById('continuousHighlightBtn');
      headerToggle.setAttribute('aria-pressed', String(penOn));
      headerToggle.querySelector('span').textContent = penOn ? '高亮 On' : erasing ? '橡皮 On' : '高亮 Off';
      headerToggle.title = penOn ? '点击关闭连续高亮（Option+Q / Esc）' : '开启连续高亮：划选文字即可保存（Option+Q）';
      status(erasing ? 'Eraser on · select highlighted text to erase · Esc to stop'
        : penOn ? 'Quick highlight on · select text to save · Option+Q to turn off' : 'Quick highlight off · Option+Q to turn on');
      if (quick && selectedParts().length) change(erasing ? 'erase' : 'highlight');
    };
    const toggleQuick = () => setMode(!quick || erasing ? 'highlight' : 'off');
    document.getElementById('readerErase').onclick = () => setMode(erasing ? 'highlight' : 'erase');
    document.getElementById('readerQuick').onclick = toggleQuick;
    document.getElementById('continuousHighlightBtn').onclick = toggleQuick;
    toggleQuick(); // Start with the pen enabled; the user can still turn it off.
    // Use the same accurate multi-row anchors for the existing selection toolbar.
    document.addEventListener('click', event => {
      if (!event.target?.closest?.('.selection-note-btn')) return;
      event.preventDefault(); event.stopImmediatePropagation(); change('highlight');
    }, true);
    document.addEventListener('mouseup', event => { if (event.button === 0 && quick && !tools.contains(event.target) && !event.target?.closest?.('#explainTooltip, #continuousHighlightBtn')) setTimeout(() => { if (selectedParts().length) change(erasing ? 'erase' : 'highlight'); }, 0); });
    document.addEventListener('keydown', event => {
      if (event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      // Physical keys also work with macOS Option symbols and held-key repeats.
      if (event.altKey && !event.ctrlKey && !event.metaKey &&
        ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract'].includes(event.code)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.code === 'Digit0') { fontSize = defaultSize; saveSize(); }
        else resize(['Equal', 'NumpadAdd'].includes(event.code) ? 2 : -2);
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.repeat &&
        ((!event.shiftKey && event.code === 'KeyQ') || (event.shiftKey && event.code === 'KeyH'))) { event.preventDefault(); event.stopImmediatePropagation(); toggleQuick(); return; }
      if (event.key === 'Escape' && quick) { event.preventDefault(); setMode('off'); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey && undo.length) { event.preventDefault(); event.stopImmediatePropagation(); change('undo'); return; }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (/^[1-5]$/.test(event.key) && (quick || selectedParts().length)) { event.preventDefault(); selectColor(Number(event.key) - 1); if (selectedParts().length) change('highlight'); }
      else if (!selectedParts().length) return;
      else if (event.key.toLowerCase() === 'h') { event.preventDefault(); change('highlight'); }
    }, true);
    let timer;
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => void paint(), 40); })
      .observe(document.getElementById('transcriptList'), { childList: true, subtree: true, characterData: true });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.ytd_reader_preferences?.newValue) {
        Object.assign(prefs, changes.ytd_reader_preferences.newValue);
      }
      if (area === 'local' && changes[key()]) { records = changes[key()].newValue || []; void paint(); }
    });
    void paint();
  });
})();
