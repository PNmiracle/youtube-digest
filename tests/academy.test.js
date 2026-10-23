const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('academy.js','utf8');
function adapter(overrides={}) { const context = vm.createContext({URL,console,setTimeout,...overrides}); vm.runInContext(source,context); return context; }
test('Descript identities support view and embed URLs and reject account pages',()=>{
  const a=adapter();
  assert.equal(a.descriptVideoId('https://share.descript.com/view/jpAgDzQoj7Z?transcript=true'),'descript:jpAgDzQoj7Z');
  assert.equal(a.descriptVideoId('https://share.descript.com/embed/jpAgDzQoj7Z'),'descript:jpAgDzQoj7Z');
  assert.equal(a.descriptVideoId('https://share.descript.com/settings'),null);
  assert.equal(a.descriptVideoId('https://evil.example/view/jpAgDzQoj7Z'),null);
});
test('Standalone Descript reads caption frames and rejects navigation during extraction',async()=>{
  let changed=false;
  const a=adapter({chrome:{tabs:{get:async()=>({url:`https://share.descript.com/view/${changed?'other':'demo'}?transcript=true`})},scripting:{executeScript:async options=>{
    assert.equal(options.target.allFrames,true);
    assert.equal(options.args[1][0],'https://share.descript.com/view/demo');
    return [{result:{success:true,videoId:'descript:demo',source:'descript-player',transcript:[{text:'Hello',start:0,duration:2}]}}];
  }}}});
  assert.equal((await a.readDescriptVideo(1,'descript:demo',true)).source,'descript-player');
  changed=true;
  assert.equal((await a.readDescriptVideo(1,'descript:demo',true)).error,'VIDEO_CHANGED');
});
test('Playback reads and seeks the native player inside the matching Academy iframe',async()=>{
  const video={currentTime:48.5,duration:240,paused:false};
  const a=adapter({location:{hostname:'academy.langchain.com',pathname:'/api/course_player/v2/contents/12/play/123'},document:{querySelector:()=>video}});
  assert.equal((await a.controlAcademyPlayback('academy:demo:12','getCurrentTime')).currentTime,48.5);
  assert.equal((await a.controlAcademyPlayback('academy:demo:12','seekTo',105.25)).currentTime,105.25);
  assert.equal((await a.controlAcademyPlayback('academy:demo:12','seekTo',-1)).success,false);
  assert.equal(video.currentTime,105.25);
  assert.equal(await a.controlAcademyPlayback('academy:demo:13','seekTo',5),null);
  assert.equal(video.currentTime,105.25);
});
test('Playback uses all frames and never substitutes zero for an unavailable player',async()=>{
  let injection;
  let results=[{frameId:0,result:null},{frameId:9,result:{success:true,videoId:'academy:demo:12',currentTime:87.5,paused:false}}];
  const a=adapter({chrome:{tabs:{get:async()=>({url:'https://academy.langchain.com/courses/take/demo/lessons/12-intro'})},scripting:{executeScript:async options=>{injection=options;return results;}}}});
  assert.equal((await a.academyPlayback(1,'academy:demo:12',{action:'getCurrentTime'})).currentTime,87.5);
  assert.equal(injection.target.allFrames,true);
  results=[{result:null}];
  const missing=await a.academyPlayback(1,'academy:demo:12',{action:'getCurrentTime'});
  assert.equal(missing.success,false);assert.equal(missing.currentTime,undefined);
});
test('Navigation during playback polling rejects the stale frame result',async()=>{
  let reads=0;
  const a=adapter({chrome:{tabs:{get:async()=>({url:`https://academy.langchain.com/courses/take/demo/lessons/${++reads===1?'12-old':'13-new'}`})},scripting:{executeScript:async()=>[{result:{success:true,currentTime:50}}]}}});
  assert.equal((await a.academyPlayback(1,'academy:demo:12',{action:'getCurrentTime'})).error,'Video changed');
});
test('Academy identities include course and lesson and reject unrelated pages',()=>{
  const a=adapter();
  assert.equal(a.academyLessonId('https://academy.langchain.com/courses/take/course-a/lessons/12-intro'),'academy:course-a:12');
  assert.equal(a.academyLessonId('https://academy.langchain.com/courses/take/course-a/multimedia/13-setup'),'academy:course-a:13');
  assert.equal(a.academyLessonId('https://evil.example/courses/take/course-a/lessons/12-intro'),null);
  assert.equal(a.academyLessonId('https://academy.langchain.com/collections/build'),null);
});
test('English caption cues are read completely, with timestamps and source labeling',async()=>{
  const track={language:'eng',label:'English',mode:'showing',cues:[{text:'Hello\nworld',startTime:1,endTime:4},{text:'Use <b>agents</b>',startTime:5,endTime:8}]};
  const document={querySelector:s=>s==='h1'?{textContent:'Course'}:s==='h3'?{textContent:'Welcome'}:s==='video'?{duration:10,textTracks:[track]}:null,querySelectorAll:()=>[]};
  const a=adapter({document,location:{hostname:'academy.langchain.com',pathname:'/courses/take/demo/lessons/12-intro'}});
  const r=await a.inspectAcademyLesson('academy:demo:12',true);
  assert.equal(r.success,true);assert.equal(r.source,'academy-player');assert.equal(r.transcript.length,2);assert.equal(r.transcript[0].text,'Hello world');assert.equal(r.transcript[1].start,5);assert.match(r.transcriptTextTimestamped,/\[0:05\] Use agents/);
});
test('A missing English track returns an explicit unavailable state',async()=>{
  const document={querySelector:s=>s==='video'?{textTracks:[{language:'chi',label:'Chinese'}]}:null,querySelectorAll:()=>[]};
  const a=adapter({document,location:{hostname:'academy.langchain.com',pathname:'/courses/take/demo/lessons/12-intro'}});
  assert.equal((await a.inspectAcademyLesson('academy:demo:12',true)).error,'ACADEMY_CAPTIONS_UNAVAILABLE');
});
test('Navigation during caption extraction rejects the old lesson response',async()=>{
  let reads=0;
  const a=adapter({chrome:{tabs:{get:async()=>({url:`https://academy.langchain.com/courses/take/demo/lessons/${++reads===1?'12-old':'13-new'}`})},scripting:{executeScript:async()=>[{result:{success:true}}]}}});
  assert.equal((await a.readAcademyLesson(1,'academy:demo:12',true)).error,'VIDEO_CHANGED');
});
test('An unrelated tab cannot be used to extract Academy content',async()=>{
  let injected=false;
  const a=adapter({chrome:{tabs:{get:async()=>({url:'https://example.com'})},scripting:{executeScript:async()=>{injected=true;}}}});
  assert.equal((await a.readAcademyLesson(1,'academy:demo:12',true)).error,'VIDEO_CHANGED');assert.equal(injected,false);
});

test('Multimedia reads nested Descript captions and preserves the written lesson',async()=>{
  const videoId='academy:demo:13';
  let injected=0;
  const a=adapter({AbortSignal,fetch:async()=>({ok:true,text:async()=>'<html>lesson</html>'}),chrome:{
    tabs:{get:async()=>({url:'https://academy.langchain.com/courses/take/demo/multimedia/13-setup'})},
    scripting:{executeScript:async options=>{
      injected++;
      if(options.func.name === 'inspectAcademyLesson') return [{result:{videoId,title:'Lesson 2',externalLessonTextUrl:'https://langchain-ai.github.io/lca-lessons/deepagents/m1/test.html'}}];
      if(options.func.name === 'parseAcademyWrittenLesson') return [{result:{text:'Written lesson and runnable code',embedUrls:['https://share.descript.com/embed/demo']}}];
      assert.equal(options.target.allFrames,true);
      return [{result:null},{result:{success:true,videoId,source:'academy-player',transcript:[{text:'First agent',start:1,duration:2}],transcriptText:'First agent'}}];
    }},
  }});
  const result=await a.readAcademyLesson(1,videoId,true);
  assert.equal(injected,3);assert.equal(result.source,'academy-player');
  assert.equal(result.transcript[0].start,1);assert.equal(result.lessonText,'Written lesson and runnable code');
  assert.equal(result.sourceKey,`${videoId}:multimedia-v2`);
});

test('Multimedia with unavailable video captions still digests the written lesson',async()=>{
  const videoId='academy:demo:13';
  const a=adapter({AbortSignal,fetch:async()=>({ok:true,text:async()=>'<html></html>'}),chrome:{tabs:{get:async()=>({url:'https://academy.langchain.com/courses/take/demo/multimedia/13-setup'})},scripting:{executeScript:async options=>{
    if(options.func.name === 'inspectAcademyLesson') return [{result:{videoId,externalLessonTextUrl:'https://langchain-ai.github.io/lca-lessons/test.html'}}];
    if(options.func.name === 'parseAcademyWrittenLesson') return [{result:{text:'Real lesson content',embedUrls:['https://share.descript.com/embed/demo']}}];
    throw new Error('Frame not loaded');
  }}}});
  const result=await a.readAcademyLesson(1,videoId,true);
  assert.equal(result.success,true);assert.equal(result.source,'academy-lesson-text');assert.equal(result.transcriptText,'Real lesson content');
});

test('Descript frame reads English cues and restores disabled caption display',async()=>{
  const track={language:'en',mode:'disabled',cues:[{text:'Run <b>an agent</b>',startTime:0.75,endTime:3.25}]};
  const video={duration:53,textTracks:[track],currentTime:12,paused:false};
  const a=adapter({location:{hostname:'share.descript.com',origin:'https://share.descript.com',pathname:'/embed/demo'},document:{querySelector:()=>video}});
  const result=await a.inspectEmbeddedAcademyPlayer('academy:demo:13',['https://share.descript.com/embed/demo']);
  assert.equal(result.transcript[0].text,'Run an agent');assert.equal(result.transcript[0].start,0.75);assert.equal(track.mode,'disabled');
  assert.equal(await a.inspectEmbeddedAcademyPlayer('academy:demo:13',['https://share.descript.com/embed/other']),null);
  assert.equal((await a.controlAcademyPlayback('academy:demo:13','seekTo',20,['https://share.descript.com/embed/demo'])).currentTime,20);
  assert.equal(await a.controlAcademyPlayback('academy:demo:13','seekTo',25,[]),null);
  assert.equal(video.currentTime,20);
});

test('Written lesson parsing only binds HTTPS Descript embeds',()=>{
  const sources=['https://share.descript.com/embed/demo','https://evil.example/embed/demo','http://share.descript.com/embed/demo','https://share.descript.com/view/demo'];
  const doc={querySelectorAll:selector=>selector==='iframe' ? sources.map(src=>({getAttribute:()=>src})) : [],querySelector:()=>null,body:{textContent:'Lesson body'}};
  const a=adapter({DOMParser:class {parseFromString(){return doc;}}});
  const result=a.parseAcademyWrittenLesson('');
  assert.deepEqual(Array.from(result.embedUrls),['https://share.descript.com/embed/demo']);assert.equal(result.text,'Lesson body');
});
