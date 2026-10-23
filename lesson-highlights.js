/* Course text highlights run inside the lesson frame, without changing its DOM. */
(() => {
  function locate(text, item) {
    if (!item || typeof item.quote !== 'string' || !item.quote) return null;
    const matches = [];
    let from = 0;
    while (from <= text.length) {
      const start = text.indexOf(item.quote, from);
      if (start < 0) break;
      const end = start + item.quote.length;
      if ((!item.prefix || text.slice(Math.max(0, start - item.prefix.length), start) === item.prefix) &&
          (!item.suffix || text.slice(end, end + item.suffix.length) === item.suffix)) matches.push({start, end});
      from = start + 1;
    }
    // Refuse ambiguous or missing text rather than color the wrong sentence.
    return matches.length === 1 ? matches[0] : null;
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = {locate}; return; }
  if (location.hostname !== 'langchain-ai.github.io' || !location.pathname.startsWith('/lca-lessons/') ||
      document.getElementById('yd-lesson-highlights')) return;

  let items = [], pending = null, queue = Promise.resolve();
  const host = document.createElement('div'); host.id = 'yd-lesson-highlights';
  Object.assign(host.style, {position:'fixed',right:'16px',bottom:'16px',zIndex:'2147483647'});
  const shadow = host.attachShadow({mode:'open'});
  shadow.innerHTML = `<style>
    :host{font:14px system-ui;color:#222}button{font:inherit;cursor:pointer;border:1px solid #d8c8ab;border-radius:8px;background:#fffaf0;color:#222;padding:8px 12px}
    #picker{display:none;margin-bottom:8px;padding:8px;background:white;border:1px solid #ddd;border-radius:12px;box-shadow:0 4px 20px #0002}
    #list{display:none;background:white;padding:12px;border:1px solid #ddd;border-radius:12px;max-width:320px;max-height:240px;overflow:auto;margin-bottom:8px}
    p{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}#status{background:#fffaf0;max-width:320px}small{display:block;margin-bottom:8px}#yellow{background:#fff099}#green{background:#b8efc5}#pink{background:#ffd0dd}
  </style><div id="list"><small>Saved on this device · YouTube Digest</small><div id="entries"></div></div>
  <div id="picker"><small>Highlight selected lesson text</small><button id="yellow">Yellow</button> <button id="green">Green</button> <button id="pink">Pink</button></div>
  <p id="status" role="status"></p><button id="toggle" aria-expanded="false">Digest highlights (0)</button>`;
  document.body.append(host);
  const $ = id => shadow.getElementById(id);
  const colors = {yellow:'#fff099',green:'#b8efc5',pink:'#ffd0dd'};
  const style = document.createElement('style');
  style.textContent = Object.entries(colors).map(([name,color]) => `::highlight(yd-lesson-${name}){background-color:${color};color:#161616}`).join('\n');
  document.head.append(style);

  function index() {
    const nodes = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement?.closest('script,style,noscript,button,input,textarea,select,[contenteditable],#yd-lesson-highlights') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let text = '', node;
    while ((node = walker.nextNode())) { nodes.push({node,start:text.length,end:text.length + node.length}); text += node.data; }
    return {nodes,text};
  }
  function rangeAt(data, start, end) {
    const a = data.nodes.find(x => start >= x.start && start < x.end);
    const b = data.nodes.find(x => end > x.start && end <= x.end);
    if (!a || !b) return null;
    const range = document.createRange(); range.setStart(a.node,start-a.start); range.setEnd(b.node,end-b.start); return range;
  }
  function render() {
    const data = index(), groups = Object.fromEntries(Object.keys(colors).map(c => [c,[]]));
    let restored = 0;
    for (const item of items) {
      const pos = locate(data.text,item), range = pos && rangeAt(data,pos.start,pos.end);
      if (range) { groups[item.color || 'yellow']?.push(range); restored++; }
    }
    for (const color of Object.keys(colors)) CSS.highlights.set(`yd-lesson-${color}`,new Highlight(...groups[color]));
    $('toggle').textContent = `Digest highlights (${items.length})`;
    $('entries').replaceChildren();
    if (!items.length) $('entries').textContent = 'Select lesson text, then choose a color.';
    for (const item of items) {
      const row = document.createElement('div'), p = document.createElement('p'), remove = document.createElement('button');
      p.textContent = item.quote; remove.textContent = 'Remove';
      remove.onclick = () => mutate({action:"removeLessonHighlight",id:item.id});
      row.append(p,remove); $('entries').append(row);
    }
    if (restored < items.length) $('status').textContent = `${items.length-restored} saved highlight(s) could not be matched to the current text.`;
  }
  async function request(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.success) throw new Error(result?.error || 'No response from Digest. Reload the extension and lesson.');
    return result.items;
  }
  function showError(stage, error) {
    console.warn('[Digest lesson highlights]',stage,error);
    $('status').textContent = `${stage}: ${error.message || String(error)}`;
  }
  function redraw() {
    try { render(); } catch (error) { showError('Could not display highlights',error); }
  }
  function mutate(message) {
    queue = queue.then(async () => {
      items = await request(message); $('status').textContent = ''; redraw();
    }).catch(error => showError('Could not save highlight',error));
    return queue;
  }
  document.addEventListener('mouseup', event => {
    if (event.composedPath().includes(host)) return;
    const selection = window.getSelection(); pending = null; $('picker').style.display = 'none';
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0), data = index();
    const a = data.nodes.find(x => x.node === range.startContainer), b = data.nodes.find(x => x.node === range.endContainer);
    if (!a || !b) return;
    const start = a.start+range.startOffset, end = b.start+range.endOffset;
    const quote = data.text.slice(start,end);
    if (!quote.trim() || quote.length > 20000 || range.toString() !== quote) return;
    pending = {quote,prefix:data.text.slice(Math.max(0,start-48),start),suffix:data.text.slice(end,end+48)};
    $('picker').style.display = 'block';
  });
  for (const color of Object.keys(colors)) {
    $(color).addEventListener('mousedown',event => event.preventDefault());
    $(color).onclick = () => {
      if (!pending) return;
      const item = {...pending,id:crypto.randomUUID(),color,createdAt:Date.now()};
      pending = null; $('picker').style.display = 'none'; window.getSelection()?.removeAllRanges();
      mutate({action:"addLessonHighlight",item});
    };
  }
  $('toggle').onclick = () => {
    const open = $('list').style.display !== 'block'; $('list').style.display = open ? 'block' : 'none'; $('toggle').setAttribute('aria-expanded',String(open));
  };
  // Storage is restricted to trusted contexts; content scripts use the worker.
  window.addEventListener('focus',() => request({action:'getLessonHighlights'}).then(saved => {items=saved;redraw();}).catch(error=>showError('Could not load highlights',error)));
  let scheduled = false;
  new MutationObserver(records => {
    if (scheduled || records.every(r => host.contains(r.target))) return;
    scheduled = true; requestAnimationFrame(() => {scheduled = false; redraw();});
  }).observe(document.body,{subtree:true,childList:true,characterData:true});
  request({action:'getLessonHighlights'}).then(saved => {items=saved;redraw();})
    .catch(error => showError('Could not load highlights',error));
})();
