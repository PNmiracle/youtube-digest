// Enhance Descript's original word nodes without replacing its timing markup.
function nativeTranscriptWords(paragraph) {
  let offset=0;
  return [...paragraph.querySelectorAll('[data-word="true"]')].map(node=>{
    const text=node.textContent.trim();
    const word={node,text,start:offset,end:offset+text.length};
    offset+=text.length+1;
    return word;
  });
}

function nativeVocabularyMatches(text,entries) {
  const matches=[];
  for(const entry of [...entries].sort((a,b)=>b.term.length-a.term.length)) {
    const term=entry.term.trim().toLowerCase();
    if(!term) continue;
    const folded=text.toLowerCase();
    let from=0;
    while(from<folded.length) {
      const start=folded.indexOf(term,from);
      if(start<0) break;
      const end=start+term.length;
      const latin=/[A-Za-z0-9]/.test(term[0]);
      if((!latin || !/[A-Za-z0-9_'’-]/.test(folded[start-1] || '') && !/[A-Za-z0-9_'’-]/.test(folded[end] || '')) &&
        !matches.some(match=>start<match.end && end>match.start)) matches.push({start,end,entry});
      from=end;
    }
  }
  return matches.sort((a,b)=>a.start-b.start);
}

globalThis.__YTD_NATIVE_TESTING__={nativeTranscriptWords,nativeVocabularyMatches};

(() => {
  if(typeof location==='undefined' || location.hostname !== 'share.descript.com' || !location.pathname.startsWith('/view/')) return;
  const videoId=()=>`descript:${location.pathname.split('/')[2]}`;
  let enabled=true,entries=[],manual=[],selection=null,refreshTimer=null;
  const translations=new Map(),pending=new Set();
  const style=document.createElement('style');
  style.textContent=`
    [data-paragraph].ytd-native-row {position:relative;padding-left:30px!important}
    .ytd-native-row [data-word] {font-size:16px;font-weight:700;cursor:text}
    .ytd-native-word,.ytd-native-manual {background:#f5d9a8;border-radius:3px;font-weight:800!important}
    .ytd-native-word[data-current-word="true"] {outline:2px solid #c9654a}
    .ytd-native-replay {position:absolute;left:0;top:4px;border:0;background:transparent;color:#b4573f;cursor:pointer;padding:4px}
    .ytd-native-controls {display:flex;gap:8px;align-items:center;margin:8px 0;font:13px system-ui}
    .ytd-native-controls button,.ytd-native-menu button {background:#fff8ef;border:1px solid #dbc9b7;border-radius:6px;padding:6px 10px;cursor:pointer;color:#563a2a}
    .ytd-native-translation {font:15px/1.8 system-ui;color:#40372e;border-left:2px solid #c9654a;padding:6px 10px;margin:8px 0 16px;white-space:pre-wrap}
    .ytd-native-translation mark {background:#f5d9a8;font-weight:800;border-radius:3px}
    .ytd-native-translation mark.ytd-native-paired {outline:2px solid #c9654a;background:#efc493}
    .ytd-native-menu,.ytd-native-tooltip {position:fixed;z-index:100001;background:#fff8ef;color:#40372e;border:1px solid #c9654a;border-radius:8px;padding:8px;box-shadow:0 4px 20px #0003;font:14px/1.6 system-ui}
    .ytd-native-menu {display:flex;gap:4px}
    .ytd-native-tooltip {max-width:min(340px,90vw);white-space:pre-wrap}
  `;
  document.head.appendChild(style);
  const menu=document.createElement('div');menu.className='ytd-native-menu';menu.hidden=true;
  menu.style.display='none';menu.setAttribute('role','toolbar');menu.setAttribute('aria-label','Digest transcript actions');
  document.body.appendChild(menu);
  let tip=null;
  const hideTip=()=>{tip?.remove();tip=null;};
  const status=(node,text)=>{node.textContent=text;};
  const send=message=>chrome.runtime.sendMessage(message);
  function showTip(text,anchor) {
    hideTip();tip=document.createElement('div');tip.className='ytd-native-tooltip';tip.setAttribute('role','tooltip');
    tip.textContent=text;
    const close=document.createElement('button');close.textContent='Close';close.style.display='block';close.addEventListener('click',hideTip);tip.appendChild(close);
    document.body.appendChild(tip);
    const rect=anchor.getBoundingClientRect();
    tip.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-tip.offsetWidth-8))}px`;
    tip.style.top=`${Math.max(8,Math.min(rect.bottom+8,innerHeight-tip.offsetHeight-8))}px`;
  }
  const source=row=>nativeTranscriptWords(row).map(word=>word.text).join(' ');
  const rowId=row=>`native-${Math.round(Number(row.dataset.startTime)*1000)}`;
  const cacheKey=row=>`ytd_native_zh_v1:${videoId()}:${rowId(row)}:${encodeURIComponent(source(row))}`;
  const relevant=row=>nativeVocabularyMatches(source(row),entries).map(match=>match.entry);
  function syncChinese(row) {
    const active=row.querySelector('[data-current-word="true"]')?.dataset.ytdVocabularyId;
    row.nextElementSibling?.querySelectorAll('mark[data-vocabulary-id]').forEach(mark=>mark.classList.toggle('ytd-native-paired',!!active && mark.dataset.vocabularyId===active));
  }
  function paintTranslation(row,item) {
    let translation=row.nextElementSibling;
    if(!translation?.classList.contains('ytd-native-translation')) {
      translation=document.createElement('div');translation.className='ytd-native-translation';row.after(translation);
    }
    const candidates=(item.matches || []).map(match=>({term:match.text,id:match.id}));
    const matches=nativeVocabularyMatches(item.text,candidates);
    translation.replaceChildren();let cursor=0;
    for(const match of matches) {
      translation.appendChild(document.createTextNode(item.text.slice(cursor,match.start)));
      const mark=document.createElement('mark');mark.textContent=item.text.slice(match.start,match.end);mark.dataset.vocabularyId=match.entry.id;
      translation.appendChild(mark);cursor=match.end;
    }
    translation.appendChild(document.createTextNode(item.text.slice(cursor)));syncChinese(row);
  }
  async function translate(row,button) {
    const id=videoId(),key=cacheKey(row),text=source(row);
    if(pending.has(key)) return;
    pending.add(key);button.disabled=true;status(button,'Translating…');
    try {
      let item=translations.get(key) || (await chrome.storage.local.get(key))[key];
      if(!item) {
        const result=await send({action:'translateContent',contentType:'transcriptBatch',targetLanguage:'zh',videoTitle:document.title,content:{segments:[{id:rowId(row),text}]}});
        if(!result?.success) throw new Error(result?.error || 'Translation failed');
        item={text:result.translatedContent.segments[0].text,matches:[]};
      }
      const vocabulary=relevant(row);
      const signature=JSON.stringify(vocabulary.map(entry=>[entry.id,entry.meaningZh]));
      if(vocabulary.length && item.signature!==signature) {
        const result=await send({action:'alignVocabularyTranslation',rows:[{id:rowId(row),source:text,translation:item.text,entries:vocabulary}]});
        if(result?.success) {item.matches=result.rows[0].matches;item.signature=signature;}
      }
      translations.set(key,item);await chrome.storage.local.set({[key]:item});
      if(id===videoId() && row.isConnected && source(row)===text) paintTranslation(row,item);
      status(button,'Chinese');
    } catch(error) {status(button,'Retry Chinese');showTip(error.message,button);}
    finally {pending.delete(key);button.disabled=false;}
  }
  async function scanWords(button) {
    button.disabled=true;status(button,'Scanning…');
    try {
      const segments=[...document.querySelectorAll('[data-paragraph="true"]')].map(row=>({text:source(row),start:Number(row.dataset.startTime)})).filter(segment=>segment.text);
      const result=await send({action:'extractVocabulary',videoId:videoId(),videoTitle:document.title,videoUrl:location.href,segments});
      if(!result?.success) throw new Error(result?.error || 'Scan failed');
      await loadWords();status(button,'Scan words');
    } catch(error) {status(button,'Retry scan');showTip(error.message,button);}
    finally {button.disabled=false;}
  }
  async function loadWords() {
    const id=videoId();
    const result=await send({action:'getVocabulary'});
    const key=`ytd_manual_highlights:${id}`;
    const saved=await chrome.storage.local.get(key);
    if(id!==videoId()) return;
    entries=result?.entries || [];manual=saved[key] || [];refresh();
    document.querySelectorAll('[data-paragraph="true"]').forEach(row=>{
      const item=translations.get(cacheKey(row));
      const signature=JSON.stringify(relevant(row).map(entry=>[entry.id,entry.meaningZh]));
      const button=row.previousElementSibling?.querySelector('button');
      if(item && item.signature!==signature && relevant(row).length && button) void translate(row,button);
    });
  }
  function enhance(row) {
    if(!enabled) return;
    row.classList.add('ytd-native-row');
    const words=nativeTranscriptWords(row),text=words.map(word=>word.text).join(' ');
    const matches=nativeVocabularyMatches(text,entries);
    const manualMatches=nativeVocabularyMatches(text,manual.filter(item=>item.start===Number(row.dataset.startTime)));
    for(const word of words) {
      const match=matches.find(match=>word.start<match.end && word.end>match.start);
      word.node.classList.toggle('ytd-native-word',!!match);
      word.node.classList.toggle('ytd-native-manual',manualMatches.some(match=>word.start<match.end && word.end>match.start));
      if(match) word.node.dataset.ytdVocabularyId=match.entry.id;else delete word.node.dataset.ytdVocabularyId;
    }
    if(!row.querySelector('.ytd-native-replay')) {
      const replay=document.createElement('button');replay.className='ytd-native-replay';replay.type='button';replay.title='Replay paragraph';replay.setAttribute('aria-label','Replay paragraph');
      replay.innerHTML='<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5 12 8l-8 5.5Z" fill="currentColor"/></svg>';
      replay.addEventListener('click',event=>{event.stopPropagation();send({action:'academyPlayback',videoId:videoId(),payload:{action:'seekTo',seconds:Number(row.dataset.startTime)}}).then(result=>{if(!result?.success) showTip(result?.error || 'Replay failed',replay);}).catch(error=>showTip(error.message,replay));});row.appendChild(replay);
    }
    if(!row.previousElementSibling?.classList.contains('ytd-native-controls')) {
      const controls=document.createElement('div');controls.className='ytd-native-controls';
      const label=document.createElement('span');label.textContent='Digest';
      const chinese=document.createElement('button');chinese.textContent='Chinese';chinese.addEventListener('click',()=>translate(row,chinese));
      const scan=document.createElement('button');scan.textContent='Scan words';scan.addEventListener('click',()=>scanWords(scan));
      controls.append(label,chinese,scan);row.before(controls);
    }
    const item=translations.get(cacheKey(row));
    if(item && !row.nextElementSibling?.classList.contains('ytd-native-translation')) paintTranslation(row,item);
    syncChinese(row);
  }
  function refresh() {document.querySelectorAll('[data-paragraph="true"]').forEach(enhance);}
  function selectWord(event) {
    if(!enabled || event.target.closest('.ytd-native-controls,.ytd-native-menu,.ytd-native-replay')) return;
    const word=event.target.closest('[data-word="true"]');if(!word) return;
    const row=word.closest('[data-paragraph="true"]');if(!row) return;
    event.preventDefault();event.stopImmediatePropagation();hideTip();
    const selected=getSelection();
    let text=selected?.toString().trim();
    if(!text || !row.contains(selected.anchorNode) || !row.contains(selected.focusNode)) {
      const range=document.createRange();range.selectNodeContents(word);selected.removeAllRanges();selected.addRange(range);text=word.textContent.trim();
    }
    selection={text,row,start:Number(row.dataset.startTime),context:source(row),videoId:videoId()};
    const rect=word.getBoundingClientRect();menu.hidden=false;menu.style.display='flex';
    menu.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-260))}px`;menu.style.top=`${Math.min(rect.bottom+8,innerHeight-60)}px`;
  }
  for(const action of ['Explain','Highlight','Save']) {
    const button=document.createElement('button');button.textContent=action;
    button.addEventListener('click',async()=>{
      const chosen=selection;if(!chosen || chosen.videoId!==videoId()) return;
      button.disabled=true;
      try {
        if(action==='Explain') {
          const result=await send({action:'explainSelection',selectedText:chosen.text,transcriptContext:chosen.context,videoTitle:document.title});
          if(!result?.success) throw new Error(result?.message || result?.error || 'Explanation failed');
          showTip(result.explanation,menu);
        } else if(action==='Highlight') {
          const key=`ytd_manual_highlights:${chosen.videoId}`;
          const saved=(await chrome.storage.local.get(key))[key] || [];
          if(!saved.some(item=>item.term===chosen.text && item.start===chosen.start)) saved.push({term:chosen.text,start:chosen.start});
          await chrome.storage.local.set({[key]:saved});manual=saved;refresh();
        } else {
          const result=await send({action:'saveVocabulary',entry:{term:chosen.text,context:chosen.context,videoId:chosen.videoId,videoTitle:document.title,timestampSeconds:chosen.start,timestampedUrl:location.href}});
          if(!result?.success) throw new Error(result?.error || 'Save failed');
          await loadWords();
        }
        menu.hidden=true;menu.style.display='none';
      } catch(error) {showTip(error.message,menu);}
      finally {button.disabled=false;}
    });menu.appendChild(button);
  }
  menu.addEventListener('mousedown',event=>{event.preventDefault();event.stopPropagation();});
  document.addEventListener('click',selectWord,true);
  for(const name of ['pointerdown','pointerup','mousedown','mouseup']) document.addEventListener(name,event=>{
    if(enabled && event.target.closest('[data-word="true"]')) event.stopPropagation();
  },true);
  document.addEventListener('pointerover',event=>{
    const word=event.target.closest('.ytd-native-word');if(!word || !enabled || menu.style.display!=='none') return;
    const entry=entries.find(entry=>entry.id===word.dataset.ytdVocabularyId);if(entry) showTip([entry.term,entry.ipa,entry.meaningZh,entry.meaningEn].filter(Boolean).join('\n'),word);
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape') {menu.hidden=true;menu.style.display='none';hideTip();}});
  new MutationObserver(records=>{
    if(records.every(record=>record.type==='attributes')) {document.querySelectorAll('.ytd-native-row').forEach(syncChinese);return;}
    clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,200);
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-current-word']});
  chrome.storage.onChanged.addListener(changes=>{if(changes.ytd_vocabulary || changes[`ytd_manual_highlights:${videoId()}`]) void loadWords();});
  void loadWords().catch(error=>console.warn('[YouTube Digest] Native transcript:',error.message));
})();
