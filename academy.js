// LangChain Academy adapter. Lesson IDs are namespaced separately from YouTube.
function academyLessonId(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/courses\/take\/([^/]+)\/(?:lessons|multimedia)\/(\d+)(?:-|$)/);
    return parsed.hostname === 'academy.langchain.com' && match
      ? `academy:${match[1]}:${match[2]}` : null;
  } catch { return null; }
}

function descriptVideoId(url) {
  try {
    const parsed=new URL(url);
    const match=parsed.pathname.match(/^\/(?:view|embed)\/([A-Za-z0-9_-]+)\/?$/);
    return parsed.protocol === 'https:' && parsed.hostname === 'share.descript.com' && match ? `descript:${match[1]}` : null;
  } catch {return null;}
}

async function readDescriptVideo(tabId,videoId,captions=true) {
  const tab=await chrome.tabs.get(tabId);
  if(descriptVideoId(tab.url) !== videoId) return {success:false,error:'VIDEO_CHANGED'};
  const url=new URL(tab.url);
  const allowed=[url.origin+url.pathname,`${url.origin}/embed/${videoId.slice('descript:'.length)}`];
  const results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:inspectEmbeddedAcademyPlayer,args:[videoId,allowed,captions]});
  if(descriptVideoId((await chrome.tabs.get(tabId)).url) !== videoId) return {success:false,error:'VIDEO_CHANGED'};
  return results.find(item=>item.result?.success)?.result || {success:false,error:'DESCRIPT_CAPTIONS_UNAVAILABLE',message:'English captions have not loaded. Play the video briefly, then click Refresh.'};
}

// Executed in the lesson's MAIN world: Wistia populates native TextTrack cues here.
// Run in every accessible Academy frame; the player iframe owns its video.
const academyEmbeddedPlayers = new Map();
async function controlAcademyPlayback(videoId, action, seconds, embedUrls = []) {
  const lessonId = videoId.split(':').pop();
  const lesson = location.pathname.match(/^\/courses\/take\/([^/]+)\/(?:lessons|multimedia)\/(\d+)(?:-|$)/);
  const playerFrame = location.pathname.match(/^\/api\/course_player\/v2\/contents\/(\d+)\/play\//);
  const isDescript = location.hostname === 'share.descript.com' && embedUrls.includes(location.origin + location.pathname);
  if (!isDescript && (location.hostname !== 'academy.langchain.com' ||
      !(lesson ? `academy:${lesson[1]}:${lesson[2]}` === videoId : playerFrame?.[1] === lessonId))) return null;
  const video = document.querySelector('video');
  if (!video) return null;
  if (action === 'seekTo') {
    if (!Number.isFinite(seconds) || seconds < 0) return {success:false,videoId,error:'Invalid playback time'};
    video.currentTime = Number.isFinite(video.duration) ? Math.min(seconds, video.duration) : seconds;
    try { if (video.paused) await video.play(); }
    catch (error) { return {success:false,videoId,error:error.message}; }
  } else if (action === 'togglePlayback') {
    try { if (video.paused) await video.play(); else video.pause(); }
    catch (error) { return {success:false,videoId,error:error.message}; }
  } else if (action !== 'getCurrentTime') return null;
  return {success:true,videoId,currentTime:video.currentTime,paused:video.paused};
}

async function academyPlayback(tabId, videoId, payload) {
  const direct=videoId?.startsWith('descript:');
  if (!Number.isInteger(tabId) || !(videoId?.startsWith('academy:') || direct)) return {success:false,error:'Lesson identity missing'};
  const tab = await chrome.tabs.get(tabId);
  if ((direct ? descriptVideoId(tab.url) : academyLessonId(tab.url)) !== videoId) return {success:false,error:'Video changed'};
  const directUrl=direct ? new URL(tab.url) : null;
  const embeds=direct ? [directUrl.origin+directUrl.pathname,`${directUrl.origin}/embed/${videoId.slice('descript:'.length)}`] : academyEmbeddedPlayers.get(videoId) || [];
  if (tab.url.includes('/multimedia/') && !academyEmbeddedPlayers.has(videoId)) await readAcademyLesson(tabId,videoId,true);
  const results = await chrome.scripting.executeScript({
    target:{tabId,allFrames:true},world:'MAIN',func:controlAcademyPlayback,
    args:[videoId,payload.action,payload.seconds ?? null,direct ? embeds : academyEmbeddedPlayers.get(videoId) || []],
  });
  if ((direct ? descriptVideoId((await chrome.tabs.get(tabId)).url) : academyLessonId((await chrome.tabs.get(tabId)).url)) !== videoId) return {success:false,error:'Video changed'};
  return results.find(r => r.result)?.result || {success:false,videoId,error:'Player unavailable'};
}

// Read the native caption track in the nested player's own frame, not its parent.
async function inspectEmbeddedAcademyPlayer(videoId, embedUrls, captions = true) {
  if (location.hostname !== 'share.descript.com' || !embedUrls.includes(location.origin + location.pathname)) return null;
  let video = document.querySelector('video');
  const playerDeadline=Date.now()+5000;
  while(!video && Date.now()<playerDeadline && embedUrls.includes(location.origin+location.pathname)) {
    await new Promise(resolve=>setTimeout(resolve,200));
    video=document.querySelector('video');
  }
  if (!video) return null;
  const info={success:true,videoId,title:document.title?.replace(/\s*-\s*Descript$/,'') || 'Descript video',channelName:'Descript',description:'',duration:Number.isFinite(video.duration) ? video.duration : 0};
  if(!captions) return info;
  const track = [...video.textTracks].find(t=>/^(en|eng)(-|$)/i.test(t.language) || /^English$/i.test(t.label));
  if (!track) return null;
  const previous = track.mode;
  if (previous === 'disabled') track.mode = 'hidden';
  try {
    const deadline=Date.now()+8000;
    while (!track.cues?.length && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,200));
    const transcript=[...(track.cues || [])].map(c=>({text:c.text.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim(),start:c.startTime,duration:c.endTime-c.startTime,language:'en'})).filter(c=>c.text);
    if(!transcript.length) return null;
    return {...info,source:videoId.startsWith('descript:') ? 'descript-player' : 'academy-player',sourceKey:`${videoId}:en`,language:'en',duration:video.duration,
      transcript,transcriptText:transcript.map(c=>c.text).join(' '),
      transcriptTextTimestamped:transcript.map(c=>`[${Math.floor(c.start/60)}:${String(Math.floor(c.start%60)).padStart(2,'0')}] ${c.text}`).join('\n')};
  } finally { if(previous === 'disabled') track.mode=previous; }
}

function parseAcademyWrittenLesson(html) {
  const doc = new DOMParser().parseFromString(html,'text/html');
  const embedUrls=[...doc.querySelectorAll('iframe')].map(frame=>{
    try {const url=new URL(frame.getAttribute('src'),'https://langchain-ai.github.io');
      return url.protocol === 'https:' && url.hostname === 'share.descript.com' && /^\/embed\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ? url.origin+url.pathname : null;
    } catch {return null;}
  }).filter(Boolean);
  doc.querySelectorAll('script,style,nav,footer,button,iframe').forEach(e=>e.remove());
  doc.querySelectorAll('h1,h2,h3,h4,p,li,pre,details,section').forEach(e=>{e.appendChild(doc.createTextNode('\n\n'));});
  const text=(doc.querySelector('main,article') || doc.body).textContent.replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  return {text,embedUrls};
}

async function inspectAcademyLesson(expectedId, loadCaptions = false) {
  const identity = () => {
    const m = location.pathname.match(/^\/courses\/take\/([^/]+)\/(?:lessons|multimedia)\/(\d+)(?:-|$)/);
    return location.hostname === 'academy.langchain.com' && m ? `academy:${m[1]}:${m[2]}` : null;
  };
  if (identity() !== expectedId) return null;
  if (loadCaptions && location.pathname.includes('/multimedia/')) {
    const deadline=Date.now()+5000;
    while (!document.querySelectorAll('iframe').length && Date.now()<deadline && identity() === expectedId)
      await new Promise(resolve=>setTimeout(resolve,200));
    if(identity() !== expectedId) return {success:false,error:'VIDEO_CHANGED'};
  }
  const course = document.querySelector('h1')?.textContent.trim() || 'LangChain Academy';
  const title = document.querySelector('h3')?.textContent.trim() || course;
  const documents = [document];
  for (const iframe of document.querySelectorAll('iframe')) {
    try { if (iframe.contentDocument) documents.push(iframe.contentDocument); } catch {}
  }
  const video = documents.map(d => d.querySelector('video')).find(Boolean);
  const info = {videoId: expectedId, title, channelName: course, description: '', duration: Number.isFinite(video?.duration) ? video.duration : 0};
  if (!loadCaptions) return info;
  if (!video && location.pathname.includes('/multimedia/')) {
    const lessonFrame = [...document.querySelectorAll('iframe')].find(f => {
      try { const u = new URL(f.src); return u.hostname === 'langchain-ai.github.io' && u.pathname.startsWith('/lca-lessons/'); } catch { return false; }
    });
    if (lessonFrame) return {...info,externalLessonTextUrl:lessonFrame.src};
    const root = document.getElementById('main-content');
    const text = root?.innerText.replace(/COMPLETE & CONTINUE|Enable fullscreen/g,'').replace(title,'').trim();
    if (text && text.length > 30) return {...info,success:true,source:'academy-lesson-text',sourceKey:`${expectedId}:text`,language:'en',transcript:[{text,start:0,duration:0,language:'en'}],transcriptText:text,transcriptTextTimestamped:text};
  }
  const track = video && [...video.textTracks].find(t => /^(en|eng)(-|$)/i.test(t.language) || /^English$/i.test(t.label));
  if (!track) return {...info, success:false, error:'ACADEMY_CAPTIONS_UNAVAILABLE', message:'No English captions are available yet. Open the lesson video, enable English captions, then click Refresh. Written lessons can be studied in the Study tab.'};
  const previousMode = track.mode;
  if (previousMode === 'disabled') track.mode = 'hidden';
  try {
    const deadline = Date.now() + 8000;
    while (!track.cues?.length && Date.now() < deadline && identity() === expectedId) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (identity() !== expectedId) return {success:false,error:'VIDEO_CHANGED'};
    const transcript = [...(track.cues || [])].map(c => ({text:c.text.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim(),start:c.startTime,duration:c.endTime-c.startTime,language:'en'})).filter(c=>c.text);
    if (!transcript.length) return {...info,success:false,error:'ACADEMY_CAPTIONS_UNAVAILABLE',message:'English captions have not loaded. Play the lesson briefly, enable English captions, and click Refresh.'};
    return {...info,success:true,source:'academy-player',sourceKey:`${expectedId}:en`,language:'en',transcript,transcriptText:transcript.map(c=>c.text).join(' '),transcriptTextTimestamped:transcript.map(c=>`[${Math.floor(c.start/60)}:${String(Math.floor(c.start%60)).padStart(2,'0')}] ${c.text}`).join('\n')};
  } finally { if (previousMode === 'disabled') track.mode = previousMode; }
}

async function readAcademyLesson(tabId, videoId, captions = false) {
  if (!Number.isInteger(tabId) || !videoId?.startsWith('academy:')) return null;
  const tab = await chrome.tabs.get(tabId);
  if (academyLessonId(tab.url) !== videoId) return {success:false,error:'VIDEO_CHANGED'};
  const results = await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:inspectAcademyLesson,args:[videoId,captions]});
  let result = results?.[0]?.result || null;
  if (result?.externalLessonTextUrl && captions) {
    const url = new URL(result.externalLessonTextUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'langchain-ai.github.io' || !url.pathname.startsWith('/lca-lessons/')) return null;
    const response = await fetch(url.href, {credentials:'omit',signal:AbortSignal.timeout(15000)});
    if (!response.ok) return {success:false,error:'ACADEMY_TEXT_UNAVAILABLE',message:'Could not load the written lesson. Click Refresh to retry.'};
    const html = await response.text();
    const parsed = await chrome.scripting.executeScript({target:{tabId},world:'MAIN',args:[html],func:parseAcademyWrittenLesson});
    const {text,embedUrls=[]} = parsed?.[0]?.result || {};
    if (!text) return {success:false,error:'ACADEMY_TEXT_UNAVAILABLE'};
    academyEmbeddedPlayers.set(videoId,embedUrls);
    let player=null;
    if(embedUrls.length) {
      try {
        const players=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:inspectEmbeddedAcademyPlayer,args:[videoId,embedUrls]});
        player=players.find(item=>item.result?.success)?.result;
      } catch(error) { console.warn('[YouTube Digest] Embedded captions unavailable:',error.message); }
    }
    result = player ? {...result,...player,lessonText:text} : {...result,success:true,source:'academy-lesson-text',sourceKey:`${videoId}:text`,language:'en',transcript:[{text,start:0,duration:0,language:'en'}],transcriptText:text,transcriptTextTimestamped:text};
    result.standaloneVideoUrls=embedUrls.map(url=>url.replace('/embed/','/view/')+'?transcript=true');
  }
  if(result?.success && tab.url.includes('/multimedia/')) result.sourceKey=`${videoId}:multimedia-v2`;
  const latest = await chrome.tabs.get(tabId);
  if (academyLessonId(latest.url) !== videoId) return {success:false,error:'VIDEO_CHANGED'};
  return result;
}
