import {LANDING_SCENES,sceneAt} from './landing-scenes.mjs?v=scenes-15-14';
export function initSceneLanding({onStart}){
 const $=id=>document.getElementById(id),root=$('landing'),video=$('scene-video'),poster=$('scene-poster'),reel=$('scene-reel'),track=$('scene-reel-track');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let selected=0,visible=!location.hash.startsWith('#/chat'),paused=reduced.matches,busy=true,frame=0,lastTime=0,position=0,target=0,autoAfter=0,hovering=false,drag=null,suppressClick=false,wheelTimer,resizeTimer,videoToken=0,activeThumb=null;
 let stride=106,firstVirtual=-16,buttons=[];
 const captionAnimations=new Set();
 const graphemes=new Intl.Segmenter('zh-CN',{granularity:'grapheme'});
 let captionReady=false;
 function finishCaption(){for(const animation of captionAnimations)animation.cancel();captionAnimations.clear();}
 function splitCaption(node,text){
  node.setAttribute('aria-label',text);
  const fragment=document.createDocumentFragment();
  for(const {segment} of graphemes.segment(text)){
   const character=document.createElement('span');character.className='scene-character';character.textContent=segment;character.setAttribute('aria-hidden','true');fragment.append(character);
  }
  node.replaceChildren(fragment);
 }
 function animateCaption(){
  finishCaption();if(!visible||document.hidden||reduced.matches)return;
  const animate=(node,keyframes,timing)=>{
   const animation=node.animate(keyframes,{...timing,easing:'cubic-bezier(.22,1,.36,1)',fill:'backwards'});captionAnimations.add(animation);
   animation.finished.then(()=>{captionAnimations.delete(animation);animation.cancel();}).catch(()=>{});
  };
  for(const [index,character]of [...$('scene-name').children].entries())animate(character,[{opacity:0,transform:'translateY(.42em)'},{opacity:1,transform:'translateY(0)'}],{duration:900,delay:60+index*55});
  for(const [index,character]of [...$('scene-description').children].entries())animate(character,[{opacity:0,transform:'translateY(.65em)'},{opacity:1,transform:'translateY(0)'}],{duration:720,delay:300+index*24});
  animate($('scene-counter'),[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:650,delay:300});
 }
 const count=LANDING_SCENES.length;
 const wrap=n=>((n%count)+count)%count;
 function paint(){
  const phase=wrap(position);
  track.style.transform=`translate3d(${firstVirtual*stride-phase*stride-48}px,0,0)`;
  const virtual=selected+Math.round((phase-selected)/count)*count;
  const next=buttons.find(b=>Number(b.dataset.virtual)===virtual);
  if(next!==activeThumb){activeThumb?.classList.remove('is-active');next?.classList.add('is-active');activeThumb=next;}
 }
 function playVideo(){if(!visible||paused||document.hidden)return;const token=videoToken;video.play().then(()=>{if(token===videoToken){root.dataset.media='video';$('scene-media-status').hidden=true;}}).catch(()=>{if(token===videoToken&&visible&&!paused&&!document.hidden){root.dataset.media='poster';$('scene-media-status').textContent='点击播放视频';$('scene-media-status').hidden=false;}});}
 function select(index,{virtual,center=true}={}){
  const next=wrap(index),changed=selected!==next;selected=next;const scene=sceneAt(selected);
  if(center){const phase=wrap(position);const destination=virtual===undefined?next+Math.round((phase-next)/count)*count:virtual;target=position+destination-phase;if(reduced.matches)position=target;autoAfter=performance.now()+3500;}
  root.dataset.scene=scene.id;if(changed||!captionReady){finishCaption();splitCaption($('scene-name'),scene.name);splitCaption($('scene-description'),scene.line);captionReady=true;animateCaption();}$('scene-status').textContent=scene.name;$('scene-counter').textContent=`${String(selected+1).padStart(2,'0')} / ${String(count).padStart(2,'0')}`;
  $('scene-open').setAttribute('aria-label',`聊聊「${scene.name}」`);$('landing-query').placeholder=`聊聊${scene.label}，或者说说你自己的事…`;
  for(const b of buttons)if(!b.hasAttribute('aria-hidden'))b.setAttribute('aria-pressed',String(Number(b.dataset.sceneIndex)===selected));
  if(changed||!video.getAttribute('src')){
   videoToken++;video.pause();root.dataset.media='poster';poster.src=scene.poster;poster.style.objectPosition=scene.position;video.poster=scene.poster;video.style.objectPosition=scene.position;video.src=scene.video;video.load();$('scene-media-status').hidden=true;$('scene-media-status').disabled=false;
   if(visible)playVideo();
  }
  paint();
 }
 function buildReel(){
  const cycles=Math.max(4,Math.ceil(innerWidth/(count*stride))+2);firstVirtual=-cycles*count;
  track.replaceChildren();buttons=[];activeThumb=null;
  for(let virtual=firstVirtual;virtual<=cycles*count;virtual++){
   const index=wrap(virtual),scene=sceneAt(index),button=document.createElement('button');button.type='button';button.className='scene-thumb';button.dataset.sceneIndex=index;button.dataset.virtual=virtual;button.setAttribute('aria-label',`切换到${scene.name}`);
   const canonical=virtual>=0&&virtual<count;if(!canonical){button.setAttribute('aria-hidden','true');button.tabIndex=-1;}else button.setAttribute('aria-pressed',String(index===selected));
   const img=document.createElement('img');img.src=scene.poster;img.alt='';img.draggable=false;button.append(img);
   button.onclick=()=>{if(suppressClick)return;select(index,{virtual});};
   button.onfocus=()=>{if(canonical){select(index);autoAfter=performance.now()+3500;}};
   track.append(button);buttons.push(button);
  }
  if(buttons.length>1)stride=buttons[1].offsetLeft-buttons[0].offsetLeft||106;
  paint();
 }
 function tick(time){
  if(!visible||document.hidden){frame=0;return;}
  const dt=Math.min(50,lastTime?time-lastTime:16);lastTime=time;
  const formFocused=$('landing-composer').contains(document.activeElement),reelFocused=reel.contains(document.activeElement);
  if(!paused&&!reduced.matches&&!hovering&&!drag&&!formFocused&&!reelFocused&&time>autoAfter){target+=dt*.00014;}
  if(!drag)position=reduced.matches?target:position+(target-position)*(1-Math.exp(-dt/105));
  paint();frame=requestAnimationFrame(tick);
 }
 function startLoop(){if(!frame&&visible&&!document.hidden){lastTime=0;frame=requestAnimationFrame(tick);}}
 function setVisible(value){const entering=value&&!visible;visible=value;if(value){if(entering)animateCaption();playVideo();startLoop();}else{finishCaption();video.pause();cancelAnimationFrame(frame);frame=0;clearTimeout(wheelTimer);drag=null;}}
 function updatePause(){if(paused){video.pause();position=target;paint();}else playVideo();}
 $('scene-media-status').onclick=()=>{paused=false;updatePause();};
 video.addEventListener('loadeddata',()=>{root.dataset.media='video';if(visible&&!paused)playVideo();});
 video.addEventListener('error',()=>{root.dataset.media='poster';$('scene-media-status').textContent='视频暂不可用 · 静态预览';$('scene-media-status').hidden=false;$('scene-media-status').disabled=true;});
 function begin(){if(busy)return;autoAfter=performance.now()+3500;onStart(sceneAt(selected),sceneAt(selected).prompt);}
 $('scene-open').addEventListener('pointerdown',()=>{autoAfter=performance.now()+3500;});
 $('scene-open').onclick=begin;
 $('landing-composer').onsubmit=e=>{e.preventDefault();if(busy)return;const text=$('landing-query').value.trim();if(!text){$('landing-query').focus();return;}onStart(sceneAt(selected),text);};
 $('landing-query').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('landing-composer').requestSubmit();}});
 reel.addEventListener('pointerenter',()=>{hovering=true;});reel.addEventListener('pointerleave',()=>{hovering=false;});
 reel.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={id:e.pointerId,start:e.clientX,position:position,moved:false};autoAfter=performance.now()+3500;});
 reel.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.start;if(Math.abs(dx)>5&&!drag.moved){drag.moved=true;reel.setPointerCapture(e.pointerId);reel.classList.add('is-dragging');}if(drag.moved){position=drag.position-dx/stride;target=position;paint();}});
 const endDrag=e=>{if(!drag||e.pointerId!==drag.id)return;const moved=drag.moved;drag=null;reel.classList.remove('is-dragging');if(moved){suppressClick=true;const nearest=Math.round(position);select(wrap(nearest),{center:false});target=nearest;setTimeout(()=>{suppressClick=false;},100);}autoAfter=performance.now()+3500;};
 reel.addEventListener('pointerup',endDrag);reel.addEventListener('pointercancel',endDrag);
 root.addEventListener('wheel',e=>{if(!visible||e.ctrlKey||e.target.closest('input,textarea,form,nav'))return;const amount=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;if(!amount)return;e.preventDefault();target+=Math.max(-500,Math.min(500,amount*(e.deltaMode===1?16:e.deltaMode===2?300:1)))/stride;autoAfter=performance.now()+3500;clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{const nearest=Math.round(target);target=nearest;select(wrap(nearest),{center:false});},110);},{passive:false});
 reel.addEventListener('keydown',e=>{const delta={ArrowRight:1,ArrowLeft:-1,ArrowDown:1,ArrowUp:-1}[e.key];if(delta===undefined&&e.key!=='Home'&&e.key!=='End')return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?count-1:wrap(selected+delta);select(next);const canonical=buttons.find(b=>Number(b.dataset.virtual)===next);canonical?.focus({preventScroll:true});});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){finishCaption();video.pause();cancelAnimationFrame(frame);frame=0;}else if(visible){playVideo();startLoop();}});
 window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(buildReel,100);});
 reduced.addEventListener('change',()=>{if(reduced.matches)finishCaption();paused=reduced.matches;position=target;updatePause();paint();});
 function setBusy(value){busy=Boolean(value);$('scene-open').disabled=busy;$('landing-send').disabled=busy;$('landing-query').disabled=busy;}
 buildReel();select(0,{center:false});updatePause();setBusy(true);setVisible(visible);
 return {setVisible,setBusy,getScene:()=>sceneAt(selected)};
}
