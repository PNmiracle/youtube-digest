(() => {
  const identity = () => {
    if(location.hostname === 'share.descript.com') {
      const match=location.pathname.match(/^\/(?:view|embed)\/([A-Za-z0-9_-]+)\/?$/);
      return match ? `descript:${match[1]}` : null;
    }
    const m = location.pathname.match(/^\/courses\/take\/([^/]+)\/(?:lessons|multimedia)\/(\d+)(?:-|$)/);
    return m ? `academy:${m[1]}:${m[2]}` : null;
  };
  const player = () => {
    for (const iframe of document.querySelectorAll('iframe')) {
      try { const video = iframe.contentDocument?.querySelector('video'); if (video) return video; } catch {}
    }
    return document.querySelector('video');
  };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    const videoId = identity();
    if (message.videoId && message.videoId !== videoId) { respond({success:false,error:'Video changed',videoId}); return false; }
    if (['getCurrentTime','seekTo','togglePlayback'].includes(message.action)) {
      chrome.runtime.sendMessage({action:'academyPlayback',videoId,payload:{action:message.action,seconds:message.seconds}})
        .then(respond).catch(error=>respond({success:false,videoId,error:error.message}));
      return true;
    }
    const video = player();
    switch (message.action) {
      case 'getVideoInfo': respond({videoId,title:document.querySelector('h3')?.textContent.trim() || document.title,channelName:document.querySelector('h1')?.textContent.trim() || 'LangChain Academy',duration:Number.isFinite(video?.duration) ? video.duration : 0,description:''}); break;
      case 'highlightMoments': case 'showNoteSavedFeedback': respond({success:true,videoId}); break;
      default: respond({success:false,error:'Unsupported lesson action',videoId});
    }
    return false;
  });
  const button = document.createElement('button');
  button.textContent = 'Open Digest'; button.title = 'Lesson overview, transcript, notes and study';
  Object.assign(button.style,{position:'fixed',right:'20px',bottom:'20px',zIndex:'10000',padding:'12px 18px',borderRadius:'24px',border:'0',background:'#c9654a',color:'white',cursor:'pointer'});
  button.addEventListener('click',()=>chrome.runtime.sendMessage({action:'openSidePanel'}));
  document.body.append(button);
  document.addEventListener('keydown',event=>{
    if(event.key.toLowerCase() !== 'd' || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
      event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    event.preventDefault();
    chrome.runtime.sendMessage({action:'openSidePanel'}).catch(()=>{});
  });

  const link=document.createElement('a');
  link.textContent='Open standalone video';
  link.target='_blank';link.rel='noopener noreferrer';
  Object.assign(link.style,{position:'fixed',right:'20px',bottom:'72px',zIndex:'10000',padding:'10px 14px',borderRadius:'20px',background:'#fffaf3',color:'#a44930',border:'1px solid #c9654a',textDecoration:'none',display:'none'});
  document.body.append(link);
  let lastLesson=null;
  const updateStandaloneLink=()=>{
    const videoId=identity();
    if(videoId === lastLesson) return;
    lastLesson=videoId;link.style.display='none';link.removeAttribute('href');
    if(!videoId?.startsWith('academy:') || !location.pathname.includes('/multimedia/')) return;
    chrome.runtime.sendMessage({action:'getAcademyVideoLinks',videoId}).then(result=>{
      if(identity() !== videoId) return;
      const url=result?.urls?.[0];
      if(!url || !/^https:\/\/share\.descript\.com\/view\/[A-Za-z0-9_-]+\/?\?transcript=true$/.test(url)) return;
      link.href=url;link.style.display='block';
    }).catch(()=>{});
  };
  new MutationObserver(updateStandaloneLink).observe(document.body,{childList:true,subtree:true});
  updateStandaloneLink();
})();
