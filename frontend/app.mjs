import {initAnswerReveals} from './answer-reveals.mjs';
import {renderMarkdown} from './answer-markdown.mjs';
import {DemoService,RealService,delay,uid} from './service.mjs';
import {createSessionGuard} from './session-guard.mjs';
import {loadRuntimeConfig} from './runtime-config.mjs';
import {clarificationModel,createTextStream,initChatViewport,recoverWaitingTurns,resultOf,runReplySequence,usedMemories} from './chat-presentation.mjs';
import {RECENT_CONVERSATION_LIMIT,conversationActivity,conversationMeta,conversationPreview,initHistoryLineNavigation,matchingConversationTurn,matchesConversation,recentConversations,sortConversations} from './conversation-library.mjs?v=direct-entry-4';
import {initHistoryReordering,movedConversationIds,orderedConversations} from './conversation-ordering.mjs?v=direct-entry-4';
import {demoProject,createProjectExamples} from './project-demo.mjs';
import {findMemoryConversation,memoryResumeContext} from './memory-navigation.mjs';
import {renderMemoryTopic,topicMemoryIds,topicSearchText,pruneMemorySnapshot,invalidateMemoryConversations} from './memory-topics.mjs';
import {buildLedgerModel,createLedgerView,disposeLedgerViews} from './decision-ledger.mjs?v=auto-text-17';
import {initSceneLanding} from './scene-landing.mjs?v=split-text-16';
import {renderGuideDetail} from './guide-detail.mjs';
import {renderGuideShare,shareableGuides} from './guide-share.mjs';
import {initWorkspaceShell} from './workspace-shell.mjs';
import {initConversationUnderstanding,buildConversationUnderstanding} from './conversation-understanding.mjs';
const projectExamples=createProjectExamples();
let historyOrders={},projectExpanded=true,memoryDialogQuery='',memoryDialogFilter='all',memoryDialogScroll=0;

const $=id=>document.getElementById(id);
const icon=(name,small=false)=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('class',name==='mark'?'brand-mark':`icon${small?' small':''}`);s.setAttribute('aria-hidden','true');const use=document.createElementNS(s.namespaceURI,'use');use.setAttribute('href','#'+name);s.append(use);return s;};
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const markdown=(text,cls='answer-text')=>renderMarkdown(el('div',undefined,cls),text);
const action=(text,handler,cls='secondary-button')=>{const b=el('button',text,cls);b.type='button';b.addEventListener('click',handler);return b;};
let local;try{local=localStorage;}catch{}
let entries=[],service=null,mode='demo',user=null,config={},conversations=[],activeId='',memories=null,memoryError='',busy=null,mutation=false,toastTimer,modalOpener=null,dialogCloseTimer=0,dialogVersion=0,modalDisposer=null,modalCancelAction=null;
const sessions=createSessionGuard(()=>({provider:service,owner:user?.id}));
let memoryReadVersion=0,memoryFetchVersion=0;
let guideReady=fetch('assets/guide.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{entries=data.entries;return entries;});
const active=()=>conversations.find(c=>c.id===activeId)||(isDemo()?projectExamples.find(c=>c.id===activeId):null);
const isDemo=()=>mode==='demo';
const blocking=()=>{if(busy||mutation){notify('请先等当前操作完成，或停止等待。');return true;}return false;};
function notify(message){$('toast').textContent=message;$('toast').hidden=false;$('announcer').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function date(value){const d=new Date(typeof value==='number'&&value<1e12?value*1000:value);return isNaN(d)?'':new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',timeZone:'Asia/Shanghai'}).format(d);}
function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function link(text,url){const href=safeUrl(url);if(!href)return el('span',text);const a=el('a',text);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;}
function closeProfileMenu(restoreFocus=false){const wasOpen=!$('profile-menu').hidden;$('profile-menu').hidden=true;$('profile-button').setAttribute('aria-expanded','false');if(wasOpen&&restoreFocus)$('profile-button').focus();}
function toggleProfileMenu(){understandingView.close();const opening=$('profile-menu').hidden;closeProfileMenu();if(opening){$('profile-menu').hidden=false;$('profile-button').setAttribute('aria-expanded','true');$('profile-menu').querySelector('button').focus();}}
document.addEventListener('click',e=>{if(!e.target.closest('.sidebar-bottom'))closeProfileMenu();});
document.addEventListener('focusin',e=>{if(!e.target.closest('.sidebar-bottom'))closeProfileMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('profile-menu').hidden){e.preventDefault();closeProfileMenu(true);}});
function openDialog(title,render,{guide=false,locator='',share=false}={}){
 understandingView.close();modalCancelAction=null;const dialog=$('dialog');clearTimeout(dialogCloseTimer);dialogVersion++;delete dialog.dataset.closing;modalDisposer?.();modalDisposer=null;
 if(!dialog.open)modalOpener=document.activeElement;
 dialog.classList.toggle('history-dialog',title==='全部对话');dialog.classList.toggle('guide-dialog',guide||share);$('dialog-kicker').hidden=!(guide||share);$('dialog-kicker').textContent=share?'生活指南 · 图片卡片':guide?'生活指南 · '+locator:'';
 $('dialog-title').textContent=title;$('dialog-body').replaceChildren();const dispose=render($('dialog-body'));if(typeof dispose==='function')modalDisposer=dispose;dialog.scrollTop=0;$('dialog-body').scrollTop=0;
 if(!dialog.open)dialog.showModal();
 if(guide||share)$('dialog-title').focus({preventScroll:true});
}
function finishDialogClose(){clearTimeout(dialogCloseTimer);modalDisposer?.();modalDisposer=null;$('dialog').close();delete $('dialog').dataset.closing;modalOpener?.focus?.({preventScroll:true});}
function closeDialog(options={}){
 const dialog=$('dialog');if(!dialog.open||dialog.dataset.closing)return;
 const cancel=options.confirmed?null:modalCancelAction;modalCancelAction=null;if(cancel){finishDialogClose();cancel();return;}
 if(dialog.classList.contains('guide-dialog')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  const current=getComputedStyle(dialog),shade=getComputedStyle(dialog,'::backdrop');
  dialog.style.setProperty('--guide-exit-opacity',current.opacity);dialog.style.setProperty('--guide-exit-transform',current.transform);dialog.style.setProperty('--guide-shade-opacity',shade.opacity);
  dialog.dataset.closing='true';const version=++dialogVersion;
  dialogCloseTimer=setTimeout(()=>{if(version===dialogVersion)finishDialogClose();},230);
 }else finishDialogClose();
}
$('dialog').addEventListener('close',()=>{if(!$('dialog').open){modalDisposer?.();modalDisposer=null;}});
$('dialog').addEventListener('cancel',event=>{if(modalCancelAction||$('dialog').classList.contains('guide-dialog')){event.preventDefault();closeDialog();}});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>{if(event.matches&&$('dialog').dataset.closing)finishDialogClose();});
$('close-dialog').onclick=closeDialog;
$('dialog').addEventListener('click',e=>{if(e.target===$('dialog')){const r=$('dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});

function historyStorage(){try{return isDemo()?local:sessionStorage;}catch{return null;}}
function historyKey(){return `lifeos.horizon.history.${mode}.${user?.id||'visitor'}`;}
function loadHistory(){try{const data=JSON.parse(historyStorage()?.getItem(historyKey())||'[]');conversations=Array.isArray(data)?recoverWaitingTurns(data.filter(c=>typeof c.id==='string'&&Array.isArray(c.turns))):[];}catch{conversations=[];}try{const selected=historyStorage()?.getItem(historyKey()+'.active');activeId=conversations.some(c=>c.id===selected)?selected:'';}catch{activeId='';}try{const saved=JSON.parse(historyStorage()?.getItem(historyKey()+'.order')||'{}');historyOrders=saved.version===1&&saved.groups&&typeof saved.groups==='object'&&!Array.isArray(saved.groups)?saved.groups:{};}catch{historyOrders={};}}
function saveHistory(){try{historyStorage()?.setItem(historyKey(),JSON.stringify(conversations));historyStorage()?.setItem(historyKey()+'.active',activeId);}catch{notify('本机历史存储空间不足，当前对话仍可继续。');}}
function rememberDraft(){const c=active();if(c&&!$('workspace').hidden){c.draft=$('query').value;c.scrollTop=$('conversation-scroll').scrollTop;saveHistory();}}
function createConversation(){rememberDraft();const c={id:uid(),title:'新对话',created:Date.now(),updated:Date.now(),turns:[],draft:'',followupId:'',serverId:''};conversations.unshift(c);activeId=c.id;$('query').value='';saveHistory();return c;}
function ensureConversation(){return active()||createConversation();}
function resetForProvider(){sessions.invalidate();memoryReadVersion++;memoryFetchVersion++;if(busy){busy.controller.abort();busy=null;}understandingView.close();conversations=[];activeId='';historyOrders={};memories=null;memoryError='';$('query').value='';$('request-error').hidden=true;$('messages').replaceChildren();renderHistory();renderMemoriesState();}
function currentRoute(){return location.hash.startsWith('#/chat')?'chat':'home';}
function navigate(route){if(blocking())return;rememberDraft();if(route==='chat'&&!active())ensureConversation();if(location.hash===`#/${route==='home'?'':route}`)renderRoute();else location.hash=route==='home'?'#/':'#/chat';}
function renderRoute(){closeProfileMenu();if(currentRoute()!=='chat')understandingView.close();disposeLedgerViews();const chat=currentRoute()==='chat';$('landing').hidden=chat;$('workspace').hidden=!chat;landingView.setVisible(!chat);landingView.setBusy(Boolean(busy)||mutation||!service);if(chat){if(!active())ensureConversation();$('query').value=active()?.draft||'';renderChat();renderHistory();workspaceView.setVisible(true);requestAnimationFrame(()=>$('query').focus({preventScroll:true}));}else{workspaceView.setVisible(false);}}
window.addEventListener('hashchange',()=>{if(busy){rememberDraft();}renderRoute();});
document.querySelector('.skip-link').onclick=e=>{e.preventDefault();$(currentRoute()==='chat'?'conversation-main':'main').focus();};
function renderProvider(){document.querySelectorAll('.mode-label').forEach(e=>e.textContent=isDemo()?'交互演示':'真实 AI');$('profile-name').textContent=isDemo()?'访客体验':user?.name||'尚未登录';$('composer-note').textContent='内容仅供参考，不构成专业意见。请结合自身情况判断并作出决定。';renderMemoriesState();}
function renderMemoriesState(){const count=(memories?.topics||memories?.memories||[]).length;document.querySelectorAll('.memory-count').forEach(e=>e.textContent=count);}
function selectConversation(c){if(blocking())return;rememberDraft();activeId=c.id;c.lastOpened=Date.now();if(!c.fixture)saveHistory();$('query').value=c.draft||'';$('request-error').hidden=true;renderChat();renderHistory();autosizeQuery();}
function historyItems(){return [...conversations,...(isDemo()?projectExamples.filter(c=>!conversations.some(saved=>saved.id===c.id)):[])].filter(c=>c.turns.length);}
function deleteConversation(c,afterDelete){if(blocking())return;confirmAction('删除这段对话？',isDemo()?'会移除此浏览器里的对话记录，已经保存的记忆仍会保留。':'会删除此浏览器里的对话记录及服务端本次对话，已经保存的记忆仍会保留。',async()=>{
 mutation=true;syncBusy();try{if(!isDemo())await service.deleteConversation(c.serverId||c.id);conversations=conversations.filter(x=>x.id!==c.id);if(activeId===c.id){activeId='';createConversation();}saveHistory();renderChat();renderHistory();mutation=false;afterDelete?.();}catch(error){notify(error.message);}finally{mutation=false;syncBusy();}
 });}
function historyRow(c){
 const row=el('div',undefined,'history-row'+(c.id===activeId?' active':''));row.dataset.conversationId=c.id;row.dataset.orderGroup=c.projectId?'project:'+c.projectId:'recent';
 const b=action('',()=>{selectConversation(c);[...$('history').querySelectorAll('.history-row')].find(row=>row.dataset.conversationId===c.id)?.querySelector('.history-select').focus({preventScroll:true});},'history-select');b.title=[c.title,conversationPreview(c)].filter(Boolean).join('\n');b.append(el('strong',c.title));
 if(!c.projectId)b.append(el('small',conversationMeta(c),'history-meta'));if(c.id===activeId)b.setAttribute('aria-current','true');row.append(b);
 b.setAttribute('aria-describedby','history-order-help');b.setAttribute('aria-keyshortcuts','Alt+ArrowUp Alt+ArrowDown');if(!c.fixture){const del=action('',()=>deleteConversation(c),'icon-button delete-history');del.setAttribute('aria-label','删除对话：'+c.title);del.append(icon('trash'));row.append(del);}return row;
}
function renderHistory(){
 historyReorder.cancel();const box=$('history'),all=$('history-all');box.replaceChildren();const items=historyItems(),projectItems=orderedConversations(items.filter(c=>c.projectId===demoProject.id),historyOrders['project:'+demoProject.id]);
 if(projectItems.length){
  const section=el('section',undefined,'sidebar-section sidebar-projects');section.setAttribute('aria-label','项目对话');section.append(el('h2','项目','history-section-title'));const group=el('div',undefined,'project-group');section.append(group);
  const heading=action('',()=>{projectExpanded=!projectExpanded;const list=$('project-conversations');heading.setAttribute('aria-expanded',String(projectExpanded));list.dataset.expanded=String(projectExpanded);list.inert=!projectExpanded;list.setAttribute('aria-hidden',String(!projectExpanded));historyLineNav.refresh();},'project-heading');heading.setAttribute('aria-expanded',String(projectExpanded));heading.setAttribute('aria-controls','project-conversations');heading.append(el('span',demoProject.title),el('small','演示'),icon('chevron'));group.append(heading);
  const list=el('div',undefined,'project-conversations');list.id='project-conversations';list.dataset.expanded=String(projectExpanded);list.inert=!projectExpanded;list.setAttribute('aria-hidden',String(!projectExpanded));const body=el('div',undefined,'project-branch-body');for(const c of projectItems)body.append(historyRow(c));list.append(body);group.append(list);box.append(section);
 }
 const recent=orderedConversations(items.filter(c=>!c.projectId),historyOrders.recent).slice(0,RECENT_CONVERSATION_LIMIT),section=el('section',undefined,'sidebar-section sidebar-recents');section.setAttribute('aria-label','最近对话');section.append(el('h2','最近对话','history-section-title'));
 if(!recent.length)section.append(el('p','聊过的事，会在这里留下线索。','history-empty'));else for(const c of recent)section.append(historyRow(c));box.append(section);
 box.append(all);$('history-total').textContent=String(items.length);historyLineNav.refresh();
}
function saveHistoryOrder(next){
 try{const storage=historyStorage();if(!storage)throw Error();storage.setItem(historyKey()+'.order',JSON.stringify({version:1,groups:next}));historyOrders=next;renderHistory();return true;}catch{notify('顺序未能保存，请检查浏览器存储后重试。');return false;}
}
function moveHistory({group,sourceId,targetId}){
 if(busy||mutation)return false;
 const items=historyItems().filter(c=>group==='recent'?!c.projectId:'project:'+c.projectId===group),ids=movedConversationIds(items,historyOrders[group],sourceId,targetId);
 if(!ids||!saveHistoryOrder({...historyOrders,[group]:ids}))return false;
 $('announcer').textContent='对话顺序已保存。';return true;
}

function showConversationLibrary(initialQuery=''){
 if(blocking())return;let query=initialQuery;
 const render=()=>openDialog('全部对话',body=>{
  const searchWrap=el('div',undefined,'history-library-search'),label=el('label','搜索全部对话','sr-only'),search=el('input');search.type='search';search.id='conversation-library-query';label.htmlFor=search.id;search.placeholder='搜索标题或聊天内容';search.value=query;searchWrap.append(label,search);
  const count=el('p','','history-library-count');count.setAttribute('role','status');const list=el('div',undefined,'history-library-list');body.append(searchWrap,count,list);
  const results=()=>{list.replaceChildren();const items=sortConversations(historyItems()).filter(c=>matchesConversation(c,query));count.textContent=`${items.length} 段对话`;
   if(!items.length)list.append(el('p',query?'没有找到相关对话，试试其他关键词。':'聊过的对话会出现在这里。','history-library-empty'));
   for(const c of items){const row=el('article',undefined,'history-library-item');row.dataset.conversationId=c.id;const open=action('',()=>{if(blocking())return;closeDialog();selectConversation(c);navigate('chat');const matched=matchingConversationTurn(c,query);if(matched)requestAnimationFrame(()=>requestAnimationFrame(()=>{const message=[...$('messages').children].find(node=>node.dataset.turnId===matched);if(message){message.classList.add('conversation-search-match');message.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});message.tabIndex=-1;message.focus({preventScroll:true});}}));},'history-library-open');open.append(el('strong',c.title),el('p',conversationPreview(c,query)),el('small',[conversationActivity(c)>0?'最近使用 '+date(conversationActivity(c)):'',`${c.turns.length} 次交流`,c.projectTitle,c.fixture?'示例':''].filter(Boolean).join(' · ')));row.append(open);
    if(!c.fixture){const controls=el('div',undefined,'history-library-actions');controls.append(action('重命名',()=>renameConversation(c,query),''),action('删除',()=>deleteConversation(c,()=>showConversationLibrary(query)),''));row.append(controls);}list.append(row);
   }
  };search.oninput=()=>{query=search.value;results();};results();requestAnimationFrame(()=>search.focus({preventScroll:true}));
 });render();
}
function renameConversation(c,returnQuery=''){
 if(blocking())return;openDialog('重命名对话',body=>{const form=el('form'),name=field('对话名称','text',c.title),error=el('p','','form-error');name.input.maxLength=60;name.input.required=true;error.setAttribute('role','alert');const controls=el('div',undefined,'dialog-actions'),save=el('button','保存','primary');save.type='submit';controls.append(action('取消',()=>showConversationLibrary(returnQuery)),save);form.append(name.wrap,error,controls);form.onsubmit=e=>{e.preventDefault();if(blocking())return;const title=name.input.value.trim();if(!title){error.textContent='请输入对话名称。';return;}c.title=title;c.customTitle=true;saveHistory();renderHistory();if(c.id===activeId)renderChat();showConversationLibrary(returnQuery);};body.append(form);requestAnimationFrame(()=>{name.input.focus();name.input.select();});});
}

function confirmAction(title,text,callback,{onCancel}={}){openDialog(title,body=>{body.append(el('p',text));const controls=el('div',undefined,'dialog-actions');controls.append(action('取消',closeDialog),action('确认',()=>{closeDialog({confirmed:true});callback();},'primary'));body.append(controls);});modalCancelAction=onCancel||null;}

async function refreshMemories(){
 const provider=service,token=sessions.capture(),read=++memoryFetchVersion;
 try{if(!isDemo()&&!user)return false;const result=await sessions.accept(token,provider.getMemories());if(!result.current||read!==memoryFetchVersion)return false;memories=result.value;memoryError='';const valid=new Set((memories.effective||[]).map(item=>item.id));for(const c of conversations){if(c.followupId&&!valid.has(c.followupId)){c.followupId='';c.followupTitle='';}if(c.recoveredMemory&&!valid.has(c.recoveredMemory.id))delete c.recoveredMemory;}saveHistory();renderMemoriesState();return true;}
 catch(e){if(!sessions.current(token)||read!==memoryFetchVersion)return false;memoryError=e.message;renderMemoriesState();return false;}
}

function guideCard(card){const box=el('article',undefined,'guide-card');box.dataset.guideId=card.guide_id;const meta=el('div',undefined,'guide-top');meta.append(el('span',card.source_locator||`指南 ${card.guide_id}`),el('span',`证据 ${card.fields?.['证据等级']||'未标注'}`,'evidence'));box.append(meta,el('h3',card.title));if(card.match_reason&&(!card.memory_ids?.length||card.memory_ids.every(id=>(memories?.memories||[]).some(m=>m.id===id))))box.append(el('p',card.match_reason,'answer-match-reason'));box.append(el('p',card.fields?.['说人话']||card.full_text||'','guide-excerpt'));if(card.fields?.['成本'])box.append(el('p','投入 · '+card.fields['成本'],'guide-cost'));const controls=el('div',undefined,'guide-actions');const more=action('读完整指南',()=>showGuide(card),'');more.append(icon('chevron'));controls.append(more,el('span','固定指南原文','source-label'));box.append(controls);return box;}
function chatHeading(conversation){
 if(!conversation?.turns.length)return '';
 if(conversation.customTitle||conversation.projectId)return conversation.title;
 const topic=buildConversationUnderstanding(conversation).topic;
 if(topic!=='你正在聊的这件事')return topic;
 const substantive=conversation.turns.find(t=>!/^(你好|您好|嗨|hello|hi|谢谢|谢谢你|好的|好|嗯|ok|再见)[！!。,.，？?\s]*$/i.test(t.query.trim()));
 return substantive?substantive.query.trim().replace(/[\r\n]+/g,' ').slice(0,28):'';
}
function renderStream(turn){
 const view=el('div',undefined,'stream-response');view.dataset.turnId=turn.id;view.dataset.state=turn.status==='waiting'?'streaming':turn.status;
 const heading=el('div',undefined,'assistant-heading');heading.append(icon('mark'),el('span','LEVO'),el('small',isDemo()?'流式演示':'回复'));const text=markdown(turn.partial||'','stream-text'),status=el('p',turn.status==='waiting'?'正在展示回复…':'这段回复尚未完成。','stream-state');view.setAttribute('aria-busy',String(turn.status==='waiting'));view.append(heading,text,status);return view;
}
function renderRecovery(turn){
 const box=el('div',undefined,'turn-recovery');box.append(el('p',turn.status==='interrupted'?'等待已中断，本轮结果尚未确认。':turn.status==='stopped'?(isDemo()?'已停止演示，本轮未写入记忆。':'已停止浏览器等待，服务器可能仍在处理。'):turn.error||'本轮未收到答复。'));
 const controls=el('div',undefined,'turn-recovery-actions');
 const retry=()=>{if(blocking())return;const run=()=>send(turn);if(!isDemo()&&['interrupted','stopped','failed'].includes(turn.status))confirmAction('重新发送这个问题？','上一轮结果尚未确认，重新发送可能造成重复处理。也可以先回到输入框继续编辑。',run);else run();};
 controls.append(action(turn.status==='failed'?'重试这一轮':'重新发送',retry,''),action('继续编辑',()=>{if(blocking())return;$('query').value=turn.query;active().draft=turn.query;autosizeQuery();$('query').focus();saveHistory();},''));box.append(controls);return box;
}
function renderMemoryReferences(result){
 const references=usedMemories(result,memories?.memories||[]);if(!references.length)return null;
 const box=el('details',undefined,'answer-memory-context');box.append(el('summary',`本轮参考了 ${references.length} 条记忆`));
 for(const ref of references){const row=el('article');if(ref.available){row.append(el('small',ref.topic||'已保存的咨询线索'),el('p',ref.text));if(ref.reasons.length)row.append(el('small','关联原因 · '+ref.reasons.join('；')));}else row.append(el('p','关联记忆已删除或不可用，不再作为后续咨询依据。'));box.append(row);}return box;
}
function renderChat(){
 answerReveals.clear();disposeLedgerViews();const c=active(),position=chatViewport.before(c),has=Boolean(c?.turns.length);$('empty-state').hidden=has||Boolean(c?.recoveredMemory);$('recovered-memory-context').hidden=!c?.recoveredMemory;
 if(c?.recoveredMemory){$('recovered-memory-topic').textContent=c.recoveredMemory.topic;$('recovered-memory-text').textContent=c.recoveredMemory.text;}
 $('messages').replaceChildren();const heading=chatHeading(c);$('conversation-title').hidden=!heading;$('conversation-title').textContent=heading;$('conversation-title').title=heading;
 $('project-example-note').hidden=!c?.projectId;$('project-example-note').textContent=c?.fixture?'项目对话演示 · 示例内容，不会写入记忆':'搬家计划 · 后续消息使用当前交互演示，示例答复仅供展示';
 $('followup-context').hidden=!c?.followupId;if(c?.followupId){$('followup-context').replaceChildren(el('span','正在继续：'+(c.followupTitle||'上次的话题')),action('取消关联',()=>{if(blocking())return;c.followupId='';saveHistory();renderChat();},'text-button'));}
 for(const turn of c?.turns||[]){
  const node=el('article',undefined,'turn');if(turn.status!=='waiting'||turn.partial)node.classList.add('is-existing');node.dataset.turnId=turn.id;node.append(el('p',turn.query,'user-message'));
  if(turn.response){
   const res=turn.response,result=resultOf(turn)||{message:'答复格式无法读取，请稍后重试。',cards:[]};
   const label=el('div',undefined,'assistant-heading');label.append(icon('mark'),el('span','LEVO'),el('small',res.example?'示例答复':isDemo()?'指南检索演示':'根据固定指南作答'));node.append(label);
   const clarification=clarificationModel(result);
   if(clarification){
    if(clarification.intro)node.append(markdown(clarification.intro));
    const panel=el('div',undefined,'clarification-card');panel.append(markdown(clarification.text,'clarification-question'));
    const controls=el('div',undefined,'clarification-options');controls.setAttribute('role','group');controls.setAttribute('aria-label','回答追问');
    const respond=(text,optionId)=>{if(blocking())return;$('query').value=text;active().draft=text;send(null,{optionId});};
    for(const option of clarification.options){const b=action(option.label,()=>respond(option.value,option.id||option.value),'');b.disabled=Boolean(busy)||turn!==c.turns.at(-1);controls.append(b);}
    if(clarification.allowSkip){const b=action('暂不补充',()=>respond('暂不补充，请先说明目前回答的范围和限制。','skip'),'clarification-skip');b.disabled=Boolean(busy)||turn!==c.turns.at(-1);controls.append(b);}
    if(controls.childNodes.length)panel.append(controls);node.append(panel);
   }else if(result.message)node.append(markdown(result.message));
   const references=renderMemoryReferences(result);if(references)node.append(references);
   const ledger=buildLedgerModel(turn.query,result);if(ledger)node.append(createLedgerView(ledger,{key:`${mode}:${user?.id||'visitor'}:${c.id}:${turn.id}`,onReadGuide:showGuide}));else for(const card of result.cards||[])node.append(guideCard(card));
   if(!result.message&&!result.clarification&&!result.cards?.length)node.append(markdown(result.markdown||res.markdown||'本轮没有可展示的指南。'));
   const foot=el('div',undefined,'answer-footer'),receipt=el('div',undefined,'memory-receipt'+(!res.summary?.saved?' failed':''));receipt.append(icon(res.summary?.saved?'check':'memory'),el('span',res.summary?.saved?'已自动记住本次咨询，可在“我的记忆”查看或删除。':res.summary?.message||'本轮未保存记忆。'));
   const models=shareableGuides(result.cards);if(!res.example&&res.summary?.message!=='本轮没有创建咨询主题。')foot.append(receipt);if(models.length){const share=action('分享指南',()=>openDialog('分享指南',body=>renderGuideShare(body,models),{share:true}),'share-button');share.prepend(icon('share'));foot.append(share);}if(foot.childNodes.length)node.append(foot);
  }else{
   if(turn.partial)node.append(renderStream(turn));
   if(['failed','stopped','interrupted'].includes(turn.status))node.append(renderRecovery(turn));
  }
  $('messages').append(node);
 }
 answerReveals.refresh();syncBusy();understandingView.render(c);chatViewport.after(c,position);autosizeQuery();
}
function syncBusy(){const running=Boolean(busy);landingView.setBusy(running||mutation||!service);$('thinking').hidden=!running||busy.phase==='user'||Boolean(busy?.turn.partial);$('send').hidden=running;$('stop').hidden=!running;$('send').disabled=running||mutation||!service;document.querySelectorAll('[data-action="new-chat"]').forEach(e=>e.disabled=running);$('thinking-text').textContent=isDemo()?'正在查找与你相关的指南':'正在等待答复与记忆处理';}
function scrollEnd(){chatViewport.end();}
function autosizeQuery(){const input=$('query');if(!$('workspace').hidden){input.style.height='auto';const height=Math.min(180,Math.max(52,input.scrollHeight));input.style.height=height+'px';input.style.overflowY=input.scrollHeight>180?'auto':'hidden';}}
async function send(retryTurn,{optionId,fromLanding=!$('landing').hidden}={}){
 if(busy||mutation||!service)return;if(!isDemo()&&!user){showLogin();return;}let c=ensureConversation();const query=(retryTurn?.query||$('query').value).trim();if(!query)return;if(query.length>2000){notify('请将问题控制在 2000 字以内。');return;}
 if(c.fixture){c=JSON.parse(JSON.stringify(c));delete c.fixture;conversations.unshift(c);}
 const previous=c.turns.at(-1),clarification=resultOf(previous)?.status==='clarification'?{query:previous.query,optionId:optionId||'free_text'}:null;
 const turn=retryTurn||{id:uid(),query,status:'waiting',requestId:uid()};if(!retryTurn){if(clarification)turn.clarificationContext=clarification;c.turns.push(turn);}turn.status='waiting';turn.error='';turn.partial='';
 if(c.turns.length===1&&!c.customTitle&&!c.recoveredMemory&&!c.sceneId)c.title=query.slice(0,22);c.updated=Date.now();$('query').value='';c.draft='';autosizeQuery();$('request-error').hidden=true;saveHistory();
 const job={controller:new AbortController(),turn,c,phase:'user',stream:createTextStream()};busy=job;renderChat();renderHistory();scrollEnd();$('announcer').textContent='消息已发送。';
 try{
  const response=await runReplySequence({fromLanding,wait:ms=>delay(ms,job.controller.signal),onStage:phase=>{if(busy!==job)return;job.phase=phase;syncBusy();if(phase==='thinking')$('announcer').textContent='正在查找相关指南。';},submit:onProgress=>service.submit({query,conversationId:c.serverId||c.id,followupId:c.followupId,requestId:turn.requestId,signal:job.controller.signal,clarification:turn.clarificationContext,onProgress}),onProgress:event=>{
   if(busy!==job||job.controller.signal.aborted||event.type!=='text_delta')return;
   const position=chatViewport.beforeDelta();turn.partial=job.stream.append(event.text);
   let view=[...$('messages').querySelectorAll('.stream-response')].find(e=>e.dataset.turnId===turn.id);
   if(!view){renderChat();view=[...$('messages').querySelectorAll('.stream-response')].find(e=>e.dataset.turnId===turn.id);}else renderMarkdown(view.querySelector('.stream-text'),turn.partial);
   syncBusy();chatViewport.afterDelta(position);
  }});
  if(busy!==job)return;job.stream.finish();turn.response=response;turn.status='completed';turn.partial='';c.serverId=response.conversation_id||c.serverId;if(c.followupId&&response.summary?.saved&&response.summary.memory_id)c.followupId=response.summary.memory_id;saveHistory();$('announcer').textContent='答复已完成。'+(response.summary?.message||'');
 }catch(e){if(busy!==job)return;if(e.name==='AbortError'){job.stream.stop();turn.status='stopped';}else{job.stream.fail();turn.status='failed';turn.error=e.message;if(!$('query').value){$('query').value=query;c.draft=query;}if(e.status===401){user=null;notify('登录已失效，请重新登录。');}}saveHistory();}
 finally{if(busy===job){busy=null;await refreshMemories();renderChat();renderHistory();chatViewport.notifyReply();}}
}
$('composer').onsubmit=e=>{e.preventDefault();send();};
$('query').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
$('query').addEventListener('input',()=>{if(active())active().draft=$('query').value;autosizeQuery();});
window.addEventListener('resize',autosizeQuery);
$('stop').onclick=()=>{if(!busy)return;busy.controller.abort();notify(isDemo()?'已停止，本轮不会保存记忆。':'已停止浏览器等待；服务器可能仍在处理。');};
$('history-search-toggle').onclick=()=>showConversationLibrary();
window.addEventListener('pagehide',rememberDraft);

function showGuide(card){openDialog(card.title,body=>renderGuideDetail(body,card),{guide:true,locator:card.source_locator||card.guide_id});}
async function showMemories({preserve=false}={}){
 if(blocking())return;if(!isDemo()&&!user){showLogin();return;}
 if(!preserve){memoryDialogQuery='';memoryDialogFilter='all';memoryDialogScroll=0;}
 const token=sessions.capture(),read=++memoryReadVersion;
 openDialog('我的记忆',body=>body.append(el('p','正在读取最新记忆…','dialog-muted')));const version=dialogVersion;
 await refreshMemories();
 if(!sessions.current(token)||read!==memoryReadVersion||version!==dialogVersion||!$('dialog').open)return;
 openDialog('我的记忆',renderMemoryDialog);
}
function renderMemoryDialog(body){
 if(memoryError){body.append(el('p','记忆暂时未能刷新。'+memoryError,'form-error'),action('重新读取',()=>showMemories({preserve:true})));return;}
 const topics=Array.isArray(memories?.topics)?memories.topics:null;
 body.append(el('p','相关原话和主题摘要会自动保存，用于之后的交流和问题回访。展开可查看来源，你可以删除单条记录或整个主题。','dialog-muted'));
 const tools=el('div',undefined,'memory-tools'),label=el('label','搜索记忆','sr-only'),search=el('input');search.type='search';search.id='memory-search';search.placeholder='搜索记住的事';search.value=memoryDialogQuery;label.htmlFor=search.id;tools.append(label,search);
 const filters=el('div',undefined,'memory-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','筛选记忆');const filterButtons=[];
 for(const [id,text]of [['all','全部'],['active','当前'],['history','历史']]){const button=action(text,()=>{memoryDialogFilter=id;update();},'');button.dataset.filter=id;filterButtons.push(button);filters.append(button);}tools.append(filters);
 const count=el('p','','memory-search-count');count.setAttribute('role','status');const wrap=el('div',undefined,'memory-list'),end=el('div',undefined,'dialog-actions');body.append(tools,count,wrap,end);
 const restore=()=>showMemories({preserve:true});
 const clear=action('删除全部记忆',()=>{memoryDialogScroll=$('dialog').scrollTop;confirmAction('删除全部记忆？','这会删除当前模式下保存的全部记忆，操作无法撤销。之后的新对话仍会自动记忆。',()=>mutateMemory(()=>service.clearMemories(),'全部记忆已删除。',{clear:true}),{onCancel:restore});},'danger-button');end.append(clear);
 function update(){
  wrap.replaceChildren();filterButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===memoryDialogFilter)));
  const query=memoryDialogQuery.trim().toLocaleLowerCase();
  if(topics){
   const list=topics.filter(topic=>(memoryDialogFilter==='all'||(memoryDialogFilter==='active'?Boolean(topic.current_memory_id):!topic.current_memory_id))&&(!query||topicSearchText(topic).includes(query)));
   count.textContent=`${list.length} 个主题`;clear.hidden=!topics.length;
   if(!list.length){const empty=el('div',undefined,'empty-memory');empty.append(el('h3',topics.length?'没有找到相关记忆':'慢慢认识你，从一次聊天开始。'),el('p',topics.length?'试试其他关键词或筛选条件。':'聊过的问题会自动在这里留下线索。'));wrap.append(empty);return;}
   for(const topic of list)wrap.append(renderMemoryTopic(topic,{
    onContinue:topic=>{closeDialog();continueFollowup({memory_id:topic.current_memory_id,topic:topic.title},{returnToSource:true});},
    onDeleteTopic:topic=>{memoryDialogScroll=$('dialog').scrollTop;confirmAction('删除整个记忆主题？','这个主题的摘要和全部来源记录都会删除，后续交流不再使用。对话历史仍会保留。',()=>mutateMemory(()=>service.deleteTopic(topic.id),'主题已删除。',{topic}),{onCancel:restore});},
    onDeleteSource:(source,topic)=>{memoryDialogScroll=$('dialog').scrollTop;confirmAction('删除这条来源记录？','这条来源记录将被删除，主题摘要会根据剩余来源重新整理。对话历史仍会保留。',()=>mutateMemory(()=>service.deleteMemory(source.id),'来源记录已删除。',{topic,sourceId:source.id}),{onCancel:restore});},
   }));
   return;
  }
  const all=(memories?.memories||[]).slice().reverse();
  const list=all.filter(m=>(memoryDialogFilter==='all'||(memoryDialogFilter==='active'?m.state==='active':m.state==='superseded'))&&(!query||`${m.problem||''} ${m.text||''}`.toLocaleLowerCase().includes(query)));count.textContent=`${list.length} 条记忆`;clear.hidden=!all.length;
  if(!list.length){const empty=el('div',undefined,'empty-memory');empty.append(el('h3',all.length?'没有找到相关记忆':'慢慢认识你，从一次聊天开始。'),el('p',all.length?'试试其他关键词或筛选条件。':'聊过的问题会自动在这里留下线索。'));wrap.append(empty);return;}
  for(const m of list){const card=el('article',undefined,'memory-item'),meta=el('div',undefined,'memory-meta');card.dataset.memoryId=m.id;meta.append(el('span',date(m.updated||m.created)),el('span',m.state==='superseded'?'历史记录':m.problem_status==='resolved'?'已解决':'咨询主题','memory-status'));card.append(meta,el('h3',m.problem||'生活话题'),el('p',m.text));const controls=el('div',undefined,'memory-actions');
   if(m.state==='active')controls.append(action('继续聊',()=>{closeDialog();continueFollowup({memory_id:m.id,topic:m.problem},{returnToSource:true});},''));
   controls.append(action('删除',()=>{memoryDialogScroll=$('dialog').scrollTop;confirmAction('删除这条记忆？','删除后不再用于后续咨询，对话历史会保留。',()=>mutateMemory(()=>service.deleteMemory(m.id),'记忆已删除。',{sourceId:m.id}),{onCancel:restore});},'danger'));card.append(controls);wrap.append(card);
  }
 }
 search.oninput=()=>{memoryDialogQuery=search.value;update();};update();requestAnimationFrame(()=>{$('dialog').scrollTop=memoryDialogScroll;});
}

function field(label,type,value){const wrap=el('div',undefined,'field'),id='field-'+uid(),l=el('label',label),input=el(type==='textarea'?'textarea':'input');l.htmlFor=id;input.id=id;if(type!=='textarea')input.type=type;input.value=value||'';wrap.append(l,input);return {wrap,input};}
async function mutateMemory(task,message,change={}){
 if(blocking())return;mutation=true;syncBusy();const provider=service;
 const ids=change.clear?null:change.topic?topicMemoryIds(change.topic):[change.sourceId];
 try{
  const result=await task();if(service!==provider)return;
  memories=pruneMemorySnapshot(memories,change);invalidateMemoryConversations(conversations,ids);
  saveHistory();renderMemoriesState();renderChat();
  // Replace the confirmation immediately. A failed read must never invite another delete or reveal a cached summary.
  openDialog('我的记忆',renderMemoryDialog);
  await refreshMemories();if(service!==provider)return;
  if(!memoryError){const valid=new Set((memories?.effective||[]).map(item=>item.id));for(const c of conversations)if(c.followupId&&!valid.has(c.followupId))c.followupId='';saveHistory();}
  mutation=false;renderChat();openDialog('我的记忆',renderMemoryDialog);notify(memoryError?message+'个人档案暂时未能刷新，请重新读取。':message);
 }catch(e){notify(e.message);}finally{mutation=false;syncBusy();}
}
function continueFollowup(f,{returnToSource=false}={}){
 if(blocking())return;if(!service){notify('正在加载指南，请稍候。');return;}
 const stored=(memories?.memories||[]).find(m=>m.id===f.memory_id),topic=(memories?.topics||[]).find(item=>item.current_memory_id===f.memory_id);
 const memory=stored?{...stored,...(topic?{problem:topic.title,text:topic.excerpts?.length?topic.excerpts.map(item=>item.quote).join('\n'):topic.text}: {})}:null;
 if(returnToSource){
  if(!memory){notify('这条记忆已不存在，请重新打开我的记忆。');return;}
  const source=findMemoryConversation(conversations,memory);
  if(source){source.followupId=memory.id;source.followupTitle=memory.problem||'上次的话题';selectConversation(source);saveHistory();navigate('chat');scrollEnd();$('query').focus({preventScroll:true});return;}
 }
 rememberDraft();const c=createConversation();c.followupId=f.memory_id;c.followupTitle=f.topic;
 if(returnToSource){const context=memoryResumeContext(memory);c.recoveredMemory={id:context.id,topic:context.topic,text:context.text};c.resumedMemoryIds=[memory.id];c.title=context.topic;c.draft=context.query;}
 else c.draft='上次聊到“'+(f.topic||'这件事')+'”，我想继续聊聊。';
 $('query').value=c.draft;saveHistory();navigate('chat');send();
}

function showSettings(){if(blocking())return;openDialog('体验设置',body=>{body.append(el('p','选择当前的体验方式','dialog-muted'));const modes=el('div',undefined,'mode-options');for(const item of [{id:'demo',title:'交互演示',text:'无需配置。使用固定指南，体验问答、记忆与持续对话。'},{id:'real',title:'真实 AI',text:config.real_model_configured?'后端已发现模型配置，登录后可以连接。':'尚未配置。需要后端接入模型服务后使用。'}]){const b=action('',()=>switchProvider(item.id),'mode-option'+(mode===item.id?' selected':''));b.append(el('strong',item.title),el('span',item.text));b.setAttribute('aria-pressed',String(mode===item.id));b.disabled=item.id==='real'&&!config.real_api_enabled;if(b.disabled)b.title='静态预览仅提供交互演示';modes.append(b);}body.append(modes,el('p',isDemo()?'当前演示不调用真实 AI。咨询主题会自动记住，和聊天记录一起保存在此浏览器。':'真实模式使用独立后端账号。本次浏览器会话保留聊天展示；相关原话和主题摘要保存在后端，可在“我的记忆”查看和删除。','dialog-muted'));if(!isDemo()){if(user)body.append(action('退出当前账号',async()=>{const provider=service,token=sessions.capture();try{await provider.logout();if(!sessions.current(token))return;user=null;resetForProvider();renderProvider();closeDialog();notify('已退出账号。');}catch(e){notify(e.message);}}));else body.append(action('登录体验账号',showLogin,'primary'));if(!config.real_model_configured)body.append(el('p','当前没有真实 AI 配置。你可以先使用交互演示；请由部署者参考仓库中的 Horizon 交接文档完成接入。','dialog-muted'));}const controls=el('div',undefined,'dialog-actions');controls.append(action('关于这个版本',showAbout),action('完成',closeDialog,'primary'));body.append(controls);});}
async function switchProvider(next){
  if(next===mode||blocking()||(next==='real'&&!config.real_api_enabled))return;
  mutation=true;
  rememberDraft();mode=next;resetForProvider();
  const provider=next==='demo'?new DemoService(entries,local):new RealService();
  service=provider;user=isDemo()?provider.user:null;
  try{
    if(!isDemo()){try{user=await provider.me();}catch(e){if(e.status!==401)notify(e.message);}}
    loadHistory();await refreshMemories();renderProvider();renderChat();renderHistory();
  }finally{mutation=false;syncBusy();}

  if(service===provider)showSettings();
}
function showLogin(){openDialog('登录真实 AI',body=>{
 if(!config.real_model_configured)body.append(el('p','目前尚未接入模型服务。登录只能查看账号中的记忆，不能验证真实问答。','dialog-muted'));
 const form=el('form'),name=field('账号','text',''),password=field('密码','password',''),error=el('p','','form-error');name.input.required=true;name.input.autocomplete='username';password.input.required=true;password.input.autocomplete='current-password';
 const controls=el('div',undefined,'dialog-actions'),submit=el('button','登录','primary');submit.type='submit';controls.append(action('返回演示',async()=>{await switchProvider('demo');closeDialog();}),submit);form.append(name.wrap,password.wrap,error,controls);
 form.onsubmit=async event=>{
  event.preventDefault();if(submit.disabled)return;submit.disabled=true;const provider=service;let token=sessions.capture();
  try{
   const result=await sessions.accept(token,provider.login(name.input.value.trim(),password.input.value));password.input.value='';if(!result.current)return;
   user=result.value;sessions.invalidate();token=sessions.capture();loadHistory();await refreshMemories();if(!sessions.current(token))return;
   if(!sessions.current(token))return;
   renderProvider();renderChat();renderHistory();closeDialog();notify('登录成功。');
  }catch(err){if(sessions.current(token))error.textContent=err.message;}finally{submit.disabled=false;}
 };body.append(form);
});}
function showAbout(){openDialog('关于 LEVO',body=>{body.append(el('p','让每一份投入，都更值得。','dialog-lead'),el('p','Make Life Worth More.','dialog-muted'),el('p','LEVO 是一个生活咨询的产品探索。你说说正在经历的事，它从固定指南中寻找可追溯的建议；自动保留咨询线索，下次继续时仍能接上话题。'),el('p','当前是独立重构的桌面版。演示模式通过关键词检索展示真实指南原文，不会调用模型，也不会假装推断你的个人情况。真实 AI 模式已接入后端契约，需要配置模型后单独验收。','dialog-muted'));body.append(el('p','视觉参考'),link('Reflect · 内容与记忆型产品','https://www.awwwards.com/sites/reflect'),el('span','　'),link('Self Aware · 视觉识别与微交互','https://www.awwwards.com/sites/self-aware'));body.append(el('p','交互借鉴 Personal Agent 的持续对话、可见记忆和返回后继续聊。没有加入代发消息、订票等当前产品尚不具备的能力。','dialog-muted'));});}
function showContact(){openDialog('联系我',body=>{body.append(el('p','欢迎交流产品设计与使用体验。'));});}
function showGuideInfo(){openDialog('建议从哪里来',body=>{body.append(el('p','687 条指南，有出处，也有边界。','dialog-lead'),el('p','本版使用《高性价比人生指南》2026-10-12 的固定快照。每条建议保留成本、收益、证据等级、原始来源和限制。'),el('p','A、B、C 是指南原作者的证据分级，不代表本产品做过独立研究。资料可能随时间改变，展示来源链接不等于实时核验。','dialog-muted'),link('查看指南项目与署名','https://github.com/eternity4719/HowToLiveBetter'),el('p','内容以 CC BY 4.0 许可使用；完整来源与许可文件位于 assets/ATTRIBUTION.txt 与 assets/GUIDE-LICENSE.txt。','dialog-muted'));});}
document.addEventListener('click',e=>{const target=e.target.closest('[data-action],[data-prompt]');if(!target)return;if(target.closest('#profile-menu'))closeProfileMenu(true);if(target.dataset.prompt){if(blocking())return;if(!service){notify('正在加载指南，请稍候。');return;}ensureConversation();active().draft=target.dataset.prompt;$('query').value=target.dataset.prompt;$('query').focus();send();return;}const handlers={start:()=>navigate('chat'),home:()=>navigate('home'),'new-chat':()=>{if(blocking())return;createConversation();navigate('chat');renderChat();renderHistory();},'conversation-library':()=>showConversationLibrary(),about:showAbout,contact:showContact,'guide-info':showGuideInfo,profile:toggleProfileMenu,settings:showSettings,memories:showMemories};handlers[target.dataset.action]?.();});

function startSceneConversation(scene,query){if(blocking())return;if(!service){notify('正在加载指南，请稍候。');return;}if(query.length>2000){notify('请将问题控制在 2000 字以内。');return;}const c=createConversation();const fromScene=query===scene.prompt;c.sceneId=fromScene?scene.id:'';c.sceneTitle=fromScene?scene.name:'';c.title=fromScene?scene.name:query.slice(0,22);c.draft=query;$('query').value=query;saveHistory();navigate('chat');send();$('landing-query').value='';}
const landingView=initSceneLanding({onStart:startSceneConversation});
const understandingView=initConversationUnderstanding({
  getConversation:active,onOpen:closeProfileMenu,
  onReveal:turnId=>{
    const turn=[...$('messages').children].find(node=>node.dataset.turnId===turnId);
    const message=turn?.querySelector('.user-message');
    if(message){
      message.tabIndex=-1;message.focus({preventScroll:true});
      message.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    }
  },
});
const answerReveals=initAnswerReveals($('messages'),$('conversation-scroll'));
const chatViewport=initChatViewport({getConversation:active});
const historyLineNav=initHistoryLineNavigation($('history'));
const historyReorder=initHistoryReordering($('history'),{onMove:moveHistory,enabled:()=>!busy&&!mutation});
const workspaceView=initWorkspaceShell({onCollapse:()=>closeProfileMenu()});
async function boot(){try{await guideReady;service=new DemoService(entries,local);user=service.user;loadHistory();await refreshMemories();renderProvider();renderRoute();}catch{notify('指南没有加载成功，请保持本地服务运行并刷新页面。');$('send').disabled=true;}config=await loadRuntimeConfig(); }
boot();
