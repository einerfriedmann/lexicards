'use strict';
const ICON_PATHS = {
 cards:'<rect x="7" y="4" width="13" height="16" rx="3"/><path d="M4 7v11a4 4 0 0 0 4 4M11 9h5M11 13h3"/>',
 home:'<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
 folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
 chart:'<path d="M4 3v17h17M8 15v-4M13 15V6M18 15v-7"/>',
 settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--panel)"/><circle cx="16" cy="12" r="2" fill="var(--panel)"/><circle cx="10" cy="18" r="2" fill="var(--panel)"/>',
 sliders:'<path d="M4 6h16M4 12h16M4 18h16"/><path d="M9 4v4M16 10v4M10 16v4"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 'arrow-right':'<path d="M5 12h14m-5-5 5 5-5 5"/>',
 'arrow-left':'<path d="M19 12H5m5-5-5 5 5 5"/>',
 'arrow-up-right':'<path d="M6 18 18 6M7 6h11v11"/>',
 'chevron-right':'<path d="m9 5 7 7-7 7"/>',
 'chevron-down':'<path d="m5 9 7 7 7-7"/>',
 sound:'<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
 more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 flame:'<path d="M12 3c1 5 6 5 6 10a6 6 0 0 1-12 0c0-3 2-5 3-7 0 3 1 4 2 5 2-3 1-5 1-8Z"/>',
 spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
 import:'<path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M12 3v12m-5-5 5 5 5-5"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
 share:'<path d="M12 16V3m-5 5 5-5 5 5M5 12H4v8h16v-8h-1"/>',
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 'check-circle':'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
 repeat:'<path d="M20 8H7a4 4 0 0 0-4 4v1m14-9 4 4-4 4M4 16h13a4 4 0 0 0 4-4v-1M7 20l-4-4 4-4"/>',
 fold:'<path d="M4 4h16M4 20h16m-9-10 3-3 3 3m-6 4 3 3 3-3"/>',
 trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>'
};
let libraryStatus = 'all', focusOrigin = 'home', lastMainPage = 'home', toastTimer = null;
const mainPages = ['home','library','decks','stats','settings'];
const pageScroll = Object.create(null);
let collapsedDecks = new Set();
try { const value=JSON.parse(localStorage.getItem('lexicards-collapsed-decks') || '[]'); if(Array.isArray(value))collapsedDecks=new Set(value.filter(k=>typeof k==='string')); } catch (_) {}
function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(ICON_PATHS[name] || ICON_PATHS.cards)+'</svg>'; }
function decorateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML=icon(node.dataset.icon); }); }
function iconButton(name,label,action,classes='icon-button') {
 const b=document.createElement('button');b.className=classes;b.innerHTML=icon(name);b.setAttribute('aria-label',label);b.onclick=action;return b;
}
function showToast(message) {
 clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.remove('hidden');toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),3200);
}
function updateUIPage(id,previous) {
 pageScroll[previous]=window.scrollY;
 if(!mainPages.includes(id) && mainPages.includes(previous))focusOrigin=previous;
 if(mainPages.includes(id))lastMainPage=id;
 document.body.dataset.page=id;document.body.classList.toggle('focus-mode',!mainPages.includes(id));
 const restore=!mainPages.includes(previous) && mainPages.includes(id);
 window.scrollTo(0,restore ? pageScroll[id] || 0 : 0);
}
function leaveFocus() { show(mainPages.includes(focusOrigin) ? focusOrigin : lastMainPage); }
function beginToday() { if(!db.cards.length)openNewCard();else if(reviewPlan(db,{newLimit:dailyNewLimit()}).cards.length)startReview();else show('decks'); }
function initializeUI() {
 decorateIcons();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ready)renderAll();});
 $('homeDate').textContent=new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();
 $('add').addEventListener('input',event=>{
  if(['fWord','fTranslation'].includes(event.target.id)){
   event.target.removeAttribute('aria-invalid');$('formError').classList.add('hidden');
  }
 });
 document.addEventListener('keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||document.querySelector('dialog[open]')||/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName || ''))return;
  const isReview=activePage==='review',isDeck=activePage==='deckStudy';if(!isReview&&!isDeck)return;
  const revealButton=$(isReview?'revealBtn':'deckReveal'),rates=$(isReview?'rateBtns':'deckRates');
  if((event.key===' '||event.key==='Enter')&&!revealButton.classList.contains('hidden')){event.preventDefault();isReview?reveal():revealDeckWord();}
  else if(!rates.classList.contains('hidden')&&['1','2'].includes(event.key)){event.preventDefault();isReview?rate(event.key==='2'):rateDeckWord(event.key==='2');}
 });
}
function renderHomeSummary() {
 const cards=db.cards,now=Date.now(),plan=reviewPlan(db,{now,newLimit:dailyNewLimit()}),pending=plan.cards;
 $('homeDate').textContent=new Date(now).toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();
 $('dailyNewLimit').value=String(dailyNewLimit());
 $('homeStreak').textContent=reviewStreak(db.reviews,now);
 $('heroCount').textContent=cards.length?pending.length:'+';
 $('heroKicker').textContent=!cards.length?'ТВОЙ ПЕРВЫЙ ШАГ':pending.length?'ПЛАН НА СЕЙЧАС':'НА СЕЙЧАС ВСЁ';
 $('heroDescription').textContent=!cards.length?'Сохрани слово, которое хочется запомнить.':pending.length?plan.due.length+' к повторению · '+plan.selectedNew.length+' новых':reviewPlanMessage(plan);
 $('todayActionLabel').textContent=!cards.length?'Добавить слово':pending.length?'Начать занятие':'Открыть колоды';
 const today=localDayOffset(now,0).getTime(),done=new Set(db.reviews.filter(r=>r.at>=today&&r.at<=now).map(r=>r.cardId)),dueIds=new Set(pending.map(c=>c.id));
 const complete=[...done].filter(id=>!dueIds.has(id)).length,total=new Set([...done,...dueIds]).size;
 $('progressText').textContent=done.size?'Сегодня разобрано: '+done.size:cards.length?'Каждая карточка — маленький шаг':'Начни с одного слова';
 $('progressBar').style.width=(total?complete/total*100:0)+'%';
 $('deckSummary').textContent=db.decks.length+' колод · '+cards.length+' карточек';
}
function clearLibrarySearch() { $('search').value='';renderLibrary();$('search').focus(); }
function setLibraryStatus(value) {
 libraryStatus=value;document.querySelectorAll('[data-status]').forEach(b=>{const current=b.dataset.status===value;b.classList.toggle('active',current);b.setAttribute('aria-pressed',String(current));});renderLibrary();
}
function openCardActions(id) {
 const c=db.cards.find(c=>c.id===id);if(!c)return;
 $('cardActionsTitle').textContent=c.word;$('cardActionsInfo').textContent=c.translation+' · '+deckPath(c.deck);
 const menu=$('cardActionsButtons');menu.replaceChildren();
 const action=(name,label,handler,danger=false)=>{
  const b=iconButton(name,label,()=>{$('cardActions').close();handler();},danger?'danger':'');
  const text=document.createElement('span');text.textContent=label;b.appendChild(text);menu.appendChild(b);
 };
 action('edit','Редактировать карточку',()=>editCard(id));action('sound','Произнести слово',()=>speakFallback(c.word,'us'));action('trash','Удалить карточку',()=>deleteCard(id),true);
 $('cardActions').showModal();
}
function openDeckActions(key) {
 const cards=db.cards.filter(c=>descendantKeys(key).has(c.deck));
 $('deckActionsTitle').textContent=deckName(key);$('deckActionsInfo').textContent=deckPath(key)+' · '+cards.length+' карточек';
 const menu=$('deckActionsButtons');menu.replaceChildren();
 for(const [name,label,handler] of [['cards','Учить эту колоду',()=>openDeck(key)],['plus','Добавить подколоду',()=>newDeck(key)],['edit','Переименовать',()=>renameDeck(key)],['folder','Переместить',()=>moveDeck(key)],['trash','Удалить колоду',()=>requestDeleteDeck(key)]]){
  const b=iconButton(name,label,()=>{$('deckActions').close();handler();},name==='trash'?'danger':'');const text=document.createElement('span');text.textContent=label;b.appendChild(text);menu.appendChild(b);
 }
 $('deckActions').showModal();
}
function persistDeckView() { try { localStorage.setItem('lexicards-collapsed-decks',JSON.stringify([...collapsedDecks])); } catch (_) {} }
function toggleDeck(key) { if(collapsedDecks.has(key))collapsedDecks.delete(key);else collapsedDecks.add(key);persistDeckView();renderDeckTree('deckList',true); }
function toggleAllDecks() {
 const parents=db.decks.filter(key=>db.decks.some(k=>db.deckMeta[k].parent===key));
 const expand=parents.some(key=>collapsedDecks.has(key));collapsedDecks=expand?new Set():new Set(parents);persistDeckView();renderDeckTree('deckList',true);
}
function folderTone(key) { return ['','blue','gold'][[...key].reduce((sum,c)=>sum+c.charCodeAt(0),0)%3]; }
function buildHomeDeck(key) {
 const scope=descendantKeys(key),cards=db.cards.filter(c=>scope.has(c.deck)),pending=cards.filter(due).length;
 const button=document.createElement('button');button.className='deck-tile';button.onclick=()=>openDeck(key);button.setAttribute('aria-label','Учить колоду '+deckName(key));
 const folder=document.createElement('span');folder.className='folder-icon '+folderTone(key);folder.innerHTML=icon('folder');
 const info=document.createElement('div');const title=document.createElement('b');title.textContent=deckName(key);const details=document.createElement('small');details.textContent=cards.length+' слов'+(scope.size>1?' · '+(scope.size-1)+' подколод':'');info.append(title,details);button.append(folder,info);
 const badge=document.createElement('span');badge.className=pending?'due-dot':'small';badge.textContent=pending?pending+' пора':'→';button.appendChild(badge);return button;
}
function buildDeckNode(key) {
 const row=document.createElement('div');row.className='listitem deck-tree-row';row.dataset.deckKey=key;
 const children=db.decks.some(d=>db.deckMeta[d].parent===key),scope=descendantKeys(key),cards=db.cards.filter(c=>scope.has(c.deck));
 if(children){const toggle=iconButton('chevron-right',(collapsedDecks.has(key)?'Раскрыть ':'Свернуть ')+deckName(key),()=>toggleDeck(key),'deck-toggle');toggle.setAttribute('aria-expanded',String(!collapsedDecks.has(key)));row.appendChild(toggle);}
 else {const space=document.createElement('span');space.className='deck-toggle placeholder';row.appendChild(space);}
 const folder=document.createElement('span');folder.className='folder-icon '+folderTone(key);folder.innerHTML=icon('folder');row.appendChild(folder);
 const main=document.createElement('button');main.className='deck-node-main';main.setAttribute('aria-label','Учить колоду '+deckName(key));main.onclick=()=>openDeck(key);
 const title=document.createElement('b');title.textContent=deckName(key);const subtitle=document.createElement('small');subtitle.textContent=cards.length+' слов · '+cards.filter(due).length+' к повторению · '+cards.filter(isNewCard).length+' новых';main.append(title,subtitle);row.appendChild(main);
 row.appendChild(iconButton('more','Действия с колодой '+deckName(key),()=>openDeckActions(key),'deck-menu'));return row;
}
function discardEditorDraft() { if(!confirm('Удалить несохранённый черновик этой карточки?'))return;resetForm();leaveFocus();showToast('Черновик удалён'); }
function clearFormError() { $('formError').textContent='';$('formError').classList.add('hidden');['fWord','fTranslation'].forEach(id=>$(id).removeAttribute('aria-invalid')); }
function validateCardForm(fields) {
 clearFormError();const field=!fields.word?'fWord':!fields.translation?'fTranslation':null;if(!field)return true;
 $('formError').textContent=field==='fWord'?'Добавь слово или выражение.':'Добавь перевод, чтобы карточку можно было повторять.';$('formError').classList.remove('hidden');$(field).setAttribute('aria-invalid','true');$(field).focus();return false;
}
function nextIntervalLabel(c) {
 const days=scheduledAnswer(c,true).interval;
 return days===1?'завтра':'через '+days+' дн.';
}
function reviewPlanMessage(plan) {
 const parts=[];
 if(plan.nextAt)parts.push('Ближайшее повторение: '+new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(plan.nextAt)+'.');
 if(plan.newCards.length&&!plan.newRemaining)parts.push('Лимит новых слов на сегодня выполнен. Следующие — завтра.');
 return parts.join(' ')||'Добавь новые слова, когда захочешь.';
}
function renderReviewCompletion() {
 const plan=reviewPlan(db,{newLimit:dailyNewLimit()});
 $('reviewEmpty').innerHTML='<div class="empty"><span class="empty-icon">'+icon('check-circle')+'</span><h2>'+(queue.length?'Сессия завершена.':'На сейчас всё.')+'</h2><p>'+esc(reviewPlanMessage(plan))+'</p><button class="primary-button" onclick="show(\'home\')">На главную '+icon('arrow-right')+'</button></div>';
}
