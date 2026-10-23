// Local study journal: self-assessment is separate from Academy completion.
(() => {
  let loadedId = null;
  let revision = 0;
  const fields = ['studyRecall', 'studyPractice', 'studyQuestion'];
  const checks = ['studyWatched', 'studyExplained', 'studyBuilt'];
  const status = () => document.getElementById('studyStatus');
  const key = id => `study_${id}`;
  const setEnabled = enabled => [...fields,...checks,'studySave','studyExport'].forEach(id => { document.getElementById(id).disabled = !enabled; });
  async function load() {
    const id = currentVideoId;
    const generation = ++revision;
    loadedId = null; setEnabled(false);
    fields.forEach(f=>document.getElementById(f).value='');
    checks.forEach(f=>document.getElementById(f).checked=false);
    document.getElementById('studyTitle').textContent = currentVideoTitle || 'Open a lesson or video';
    if (!id) return;
    try {
      const stored = await chrome.storage.local.get(key(id));
      if (generation !== revision || id !== currentVideoId) return;
      const data = stored[key(id)] || {};
      fields.forEach(f=>document.getElementById(f).value=data[f] || '');
      checks.forEach(f=>document.getElementById(f).checked=Boolean(data[f]));
      loadedId = id; setEnabled(true);
      status().textContent = data.updatedAt ? 'Saved study journal loaded.' : 'Your progress is saved locally with this lesson.';
    } catch { status().textContent = 'Could not load the journal. Reopen Study to retry.'; }
  }
  async function save() {
    if (!loadedId || loadedId !== currentVideoId) return;
    const id = loadedId;
    const data = {title:currentVideoTitle,url:currentVideoUrl,course:currentChannelName,updatedAt:new Date().toISOString()};
    fields.forEach(f=>data[f]=document.getElementById(f).value);
    checks.forEach(f=>data[f]=document.getElementById(f).checked);
    try {
      await chrome.storage.local.set({[key(id)]:data});
      if (id === loadedId) status().textContent = `Saved · ${checks.filter(f=>data[f]).length}/3 learning steps checked`;
    } catch { status().textContent = 'Save failed. Keep this tab open and try again.'; }
  }
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelector('[data-tab="study"]').addEventListener('click',()=>void load());
    document.getElementById('studySave').addEventListener('click',()=>void save());
    [...fields,...checks].forEach(id=>document.getElementById(id).addEventListener('input',()=>{status().textContent='Unsaved changes — click Save journal.';}));
    document.getElementById('studyExport').addEventListener('click',()=>{
      if (!loadedId || loadedId !== currentVideoId) return;
      const text = `# ${currentVideoTitle || 'Lesson'} — Study Journal\n\nCourse: ${currentChannelName || ''}\nSource: ${currentVideoUrl || ''}\n\n## Contents\n\n- [Progress](#progress)\n- [Recall](#recall)\n- [Practice](#practice)\n- [Questions](#questions)\n\n<a id="progress"></a>\n## Progress\n\n${checks.map((f,i)=>`- [${document.getElementById(f).checked?'x':' '}] ${['Watched or read the lesson','Explained the idea without looking','Ran a small example and checked the result'][i]}`).join('\n')}\n\n<a id="recall"></a>\n## Recall\n\n${document.getElementById('studyRecall').value}\n\n<a id="practice"></a>\n## Practice\n\n${document.getElementById('studyPractice').value}\n\n<a id="questions"></a>\n## Questions\n\n${document.getElementById('studyQuestion').value}\n`;
      downloadTextFile(text,`${sanitizeFilename(currentVideoTitle)}-study.md`);
    });
    // Clear old lesson data on navigation, even while Study remains visible.
    chrome.tabs.onActivated.addListener(()=>{revision++;loadedId=null;setEnabled(false);});
    chrome.tabs.onUpdated.addListener((tabId,change)=>{if(tabId===youtubeTabId && change.url){revision++;loadedId=null;setEnabled(false);}});
    new MutationObserver(()=>{
      if(document.querySelector('[data-tab="study"].active') && loadedId !== currentVideoId) void load();
    }).observe(document.getElementById('videoTitle'),{childList:true,subtree:true,characterData:true});
  });
})();
