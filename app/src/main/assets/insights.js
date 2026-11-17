'use strict';
// Stable deck keys keep cards, history and drafts attached when a deck is moved
// or renamed. Existing versions' string deck names migrate to root deck keys.
function normalizeDeckMeta(state,decks) {
 const source = state.deckMeta || {}, meta = Object.create(null);
 for (const key of decks) {
  const old = Object.prototype.hasOwnProperty.call(source,key) ? source[key] : null;
  const name = text(old?.name ?? key,200).trim();
  if (!name) throw new Error('У колоды нет названия.');
  const parent = old?.parent == null || old.parent === '' ? null : String(old.parent);
  if (parent !== null && !decks.includes(parent)) throw new Error('Родительская колода не найдена: ' + name);
  meta[key] = {name,parent};
 }
 const siblings = new Set();
 for (const key of decks) {
  const seen = new Set([key]); let parent = meta[key].parent, depth = 0;
  while (parent !== null) {
   if (seen.has(parent)) throw new Error('Колоды не могут быть вложены друг в друга по кругу.');
   seen.add(parent); parent = meta[parent].parent;
   if (++depth > 16) throw new Error('Можно создать до 16 уровней подколод.');
  }
  const signature = JSON.stringify([meta[key].parent,meta[key].name]);
  if (siblings.has(signature)) throw new Error('В одной колоде повторяется название подколоды: ' + meta[key].name);
  siblings.add(signature);
 }
 return meta;
}
function normalizeReviewHistory(reviews) {
 if (reviews == null) return [];
 if (!Array.isArray(reviews) || reviews.length > 1000000) throw new Error('Неверная история повторений.');
 const ids = new Set();
 return reviews.map(r => {
  const id = text(r.id,200), cardId = text(r.cardId,200), deck = text(r.deck,200), at = Number(r.at);
  if (!id || ids.has(id) || !cardId || !Number.isFinite(at) || at < 0 || at > 8640000000000000 || ![true,false,0,1].includes(r.known)) throw new Error('Повреждена запись истории повторений.');
  ids.add(id);
  return {id,cardId,deck,at:Math.floor(at),known:!!r.known,interval:number(r.interval,0,0,36500),introduced:r.introduced===true||r.introduced===1};
 });
}
function deckName(key,state = db) { return state.deckMeta?.[key]?.name || key; }
function deckAncestors(key,state = db) {
 const keys = []; let cursor = key;
 while (cursor != null) { keys.unshift(cursor); cursor = state.deckMeta?.[cursor]?.parent ?? null; }
 return keys;
}
function deckPath(key,state = db) { return deckAncestors(key,state).map(k => deckName(k,state)).join(' / '); }
function descendantKeys(key,state = db) {
 const result = new Set([key]);
 for (let changed = true; changed;) {
  changed = false;
  for (const d of state.decks) if (!result.has(d) && result.has(state.deckMeta?.[d]?.parent)) { result.add(d); changed = true; }
 }
 return result;
}
function deckTree(state = db) {
 const result = [];
 function visit(parent,depth) {
  for (const key of state.decks) if ((state.deckMeta?.[key]?.parent ?? null) === parent) { result.push({key,depth}); visit(key,depth + 1); }
 }
 visit(null,0); return result;
}
function ensureDeckPath(state,path) {
 if (!Array.isArray(path) || !path.length || path.length > 17) throw new Error('Неверный путь колоды в CSV.');
 state.deckMeta = Object.assign(Object.create(null),state.deckMeta || {});
 let parent = null;
 for (const value of path) {
  const name = text(value,200).trim(); if (!name) throw new Error('Пустое название колоды в CSV.');
  let key = state.decks.find(d => (state.deckMeta[d]?.parent ?? null) === parent && deckName(d,state) === name);
  if (!key) {
   key = parent === null && !state.decks.includes(name) ? name : 'deck_' + uid();
   state.decks.push(key); state.deckMeta[key] = {name,parent};
  }
  parent = key;
 }
 return parent;
}
function deckOption(key,depth = 0) {
 const option = document.createElement('option'); option.value = key;
 option.textContent = '　'.repeat(Math.min(depth,4)) + (depth ? '↳ ' : '') + deckName(key);
 return option;
}
function fillHierarchyFilter(id) {
 const select = $(id), value = select.value;
 const all = document.createElement('option'); all.value = ''; all.textContent = 'Все колоды';
 select.replaceChildren(all,...deckTree().map(d => deckOption(d.key,d.depth)));
 if (db.decks.includes(value)) select.value = value;
}
function renderDeckTree(target,editable) {
 const tree=deckTree();
 if(!tree.length){const empty=document.createElement('div');empty.className='empty';empty.innerHTML='<p>Создай колоду для своих слов.</p>';empty.appendChild(makeButton('Создать колоду',()=>newDeck(),'secondary'));$(target).replaceChildren(empty);return;}
 if(!editable){$(target).replaceChildren(...tree.filter(d=>d.depth===0).slice(0,4).map(d=>buildHomeDeck(d.key)));return;}
 const elements=tree.filter(d=>!deckAncestors(d.key).slice(0,-1).some(k=>collapsedDecks.has(k))).map(({key,depth})=>{
  const row=buildDeckNode(key);row.style.marginLeft=Math.min(depth,3)*10+'px';if(depth)row.classList.add('subdeck-row');return row;
 });
 $(target).replaceChildren(...elements);
}
function newDeck(parent = null) { openDeckEditor(null,parent); }
function renameDeck(key) { openDeckEditor(key,null,'rename'); }
function moveDeck(key) { openDeckEditor(key,null,'move'); }
function openDeckEditor(key = null,parent = null,mode = 'create') {
 const dialog = $('deckEditor'); dialog.dataset.key = key || ''; dialog.dataset.mode=mode;
 $('deckEditorTitle').textContent = key ? (mode==='move'?'Переместить колоду':'Переименовать колоду') : parent ? 'Новая подколода' : 'Новая колода';
 $('deckEditorName').value = key ? deckName(key) : '';
 $('deckEditorError').textContent = '';
 $('deckNameField').classList.toggle('hidden',mode==='move');$('deckParentField').classList.toggle('hidden',mode==='rename');
 const select = $('deckEditorParent'), root = document.createElement('option'); root.value = ''; root.textContent = 'Без родителя — отдельная колода';
 const forbidden = key ? descendantKeys(key) : new Set();
 select.replaceChildren(root,...deckTree().filter(d => !forbidden.has(d.key)).map(d => { const o = deckOption(d.key,d.depth); o.textContent = deckPath(d.key); return o; }));
 select.value = key ? db.deckMeta[key].parent || '' : parent || '';
 dialog.showModal(); $(mode==='move'?'deckEditorParent':'deckEditorName').focus();
}
async function saveDeckEditor() {
 const key = $('deckEditor').dataset.key || null, mode=$('deckEditor').dataset.mode;
 const name=mode==='move'?deckName(key):$('deckEditorName').value.trim(),parent=mode==='rename'?db.deckMeta[key].parent:($('deckEditorParent').value||null);
 if (!name || name.length > 200) { $('deckEditorError').textContent = 'Название: от 1 до 200 символов.'; return; }
 const success = await perform(async () => {
  await mutateState(next => {
   next.deckMeta = Object.assign(Object.create(null),next.deckMeta);
   if (parent && !next.decks.includes(parent)) throw new Error('Родительская колода уже не существует.');
   if (key) {
    if (!next.decks.includes(key) || descendantKeys(key,next).has(parent)) throw new Error('Нельзя переместить колоду внутрь самой себя.');
    next.deckMeta[key] = {name,parent};
   } else {
    const created = parent === null && !next.decks.includes(name) ? name : 'deck_' + uid();
    next.decks.push(created); next.deckMeta[created] = {name,parent};
   }
  });
 },{onError:e=>{$('deckEditorError').textContent=e.message;}});
 if (success) {$('deckEditor').close();showToast(key?(mode==='move'?'Колода перемещена':'Колода переименована'):'Колода создана');}
}
function requestDeleteDeck(key) {
 if(!db.decks.includes(key))return;
 const scope=descendantKeys(key),count=db.cards.filter(c=>scope.has(c.deck)).length;
 $('deleteDeckDialog').dataset.key=key;
 $('deleteDeckTitle').textContent='Удалить «'+deckName(key)+'»?';
 $('deleteDeckInfo').textContent='Будут удалены: '+scope.size+' колод и '+count+' карточек'+(scope.size>1?', включая подколоды.':'.');
 $('deleteDeckError').textContent='';$('deleteDeckDialog').showModal();
}
async function confirmDeleteDeck() {
 const key=$('deleteDeckDialog').dataset.key;
 const success=await perform(async()=>{
  await mutateState(next=>{
   if(!next.decks.includes(key))throw new Error('Колода уже удалена.');
   const scope=descendantKeys(key,next);
   next.cards=next.cards.filter(c=>!scope.has(c.deck));
   next.decks=next.decks.filter(d=>!scope.has(d));
   for(const d of scope)delete next.deckMeta[d];
  });
 },{onError:e=>{$('deleteDeckError').textContent=e.message;}});
 if(success){$('deleteDeckDialog').close();showToast('Колода удалена');}
}
function localDayKey(value) {
 const d = new Date(value);
 return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function localDayOffset(now,offset) {
 const d = new Date(now); return new Date(d.getFullYear(),d.getMonth(),d.getDate()+offset);
}
function reviewStreak(reviews,now) {
 const days = new Set(reviews.filter(r => r.at <= now).map(r => localDayKey(r.at)));
 let date = localDayOffset(now,days.has(localDayKey(now)) ? 0 : -1), streak = 0;
 while (days.has(localDayKey(date))) { streak++; date.setDate(date.getDate()-1); }
 return streak;
}
function statisticsSnapshot(state,deck = '',period = '7',now = Date.now()) {
 const scope = deck ? descendantKeys(deck,state) : new Set(state.decks);
 const cards = state.cards.filter(c => scope.has(c.deck));
 const allReviews = (state.reviews || []).filter(r => r.at <= now && (!deck || scope.has(r.deck)));
 const days = period === 'all' ? 30 : Number(period) === 30 ? 30 : 7;
 const cutoff = period === 'all' ? 0 : localDayOffset(now,1-days).getTime();
 const reviews = allReviews.filter(r => r.at >= cutoff);
 const buckets = Array.from({length:days},(_,i) => { const day = localDayOffset(now,i-days+1); return {key:localDayKey(day),at:day.getTime(),count:0,known:0}; });
 const lookup = new Map(buckets.map(b => [b.key,b]));
 for (const review of reviews) { const b = lookup.get(localDayKey(review.at)); if (b) { b.count++; if (review.known) b.known++; } }
 const known = reviews.filter(r => r.known).length;
 const misses = new Map(); for (const r of reviews) if (!r.known) misses.set(r.cardId,(misses.get(r.cardId)||0)+1);
 const difficult = cards.map(c => ({card:c,misses:misses.get(c.id)||0})).filter(c => c.misses).sort((a,b) => b.misses-a.misses).slice(0,5);
 return {cards,reviews,known,rate:reviews.length ? Math.round(known/reviews.length*100) : null,streak:reviewStreak(allReviews,now),buckets,difficult,
  fresh:cards.filter(isNewCard).length,later:cards.filter(c=>reviewStatus(c,now)==='later').length,learning:cards.filter(c => c.reps===1).length,learned:cards.filter(c => c.reps>=2).length,due:cards.filter(c=>isReviewDue(c,now)).length};
}
function renderStatistics() {
 if (!ready) return;
 const deck = $('statsDeck').value, period = $('statsPeriod').value;
 const s = statisticsSnapshot(db,deck,period), label = period==='all' ? 'за всё время' : 'за '+period+' дней';
 $('statsAttempts').textContent = s.reviews.length; $('statsRate').textContent = s.rate===null ? '—' : s.rate+'%';
 $('statsStreak').textContent = s.streak; $('statsLearned').textContent = new Set(s.reviews.map(r=>r.cardId)).size;
 $('statsPeriodLabel').textContent = period==='all' ? 'Повторения за последние 30 дней' : 'Повторения '+label; $('statsScope').textContent = deck ? deckPath(deck)+' · с подколодами' : 'Все колоды';
 $('statsDue').textContent = s.due; $('statsTotal').textContent = s.cards.length;
 $('statsHistoryNote').classList.toggle('hidden',!!db.reviews.length);
 const total = s.cards.length || 1;
 $('statsDistribution').replaceChildren(...[['Новые',s.fresh,'#a5b3c7'],['Пора повторить',s.due,'#e6c989'],['Повторить позже',s.later,'#8ce0bd']].map(([name,count,color]) => {
  const row = document.createElement('div'); row.className='distribution-row';
  const label = document.createElement('div'); label.className='row';label.innerHTML='<span>'+name+'</span><b class="fit">'+count+'</b>';
  const bar=document.createElement('div');bar.className='progress';const fill=document.createElement('i');fill.style.width=count/total*100+'%';fill.style.background=color;bar.appendChild(fill);row.append(label,bar);return row;
 }));
 const peak = Math.max(1,...s.buckets.map(b => b.count)), chart=$('statsChart');
 chart.style.gridTemplateColumns='repeat('+s.buckets.length+',minmax(0,1fr))';
 chart.replaceChildren(...s.buckets.map((b,i) => {
  const col=document.createElement('button');col.className='chart-column';
  const date=new Date(b.at).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
  col.setAttribute('aria-label',date+': '+b.count+' повторений, «Знаю»: '+b.known);
  const rail=document.createElement('span');rail.className='chart-rail';const bar=document.createElement('i');bar.style.height=(b.count/peak*100)+'%';rail.appendChild(bar);
  const tick=document.createElement('span');tick.className='chart-tick';tick.textContent=s.buckets.length===7 || i%5===0 || i===s.buckets.length-1 ? new Date(b.at).getDate() : '';
  col.append(rail,tick);col.onclick=()=>{$('statsChartDetail').textContent=date+': '+b.count+' повторений, «Знаю»: '+b.known;};return col;
 }));
 $('statsChartDetail').textContent=period==='all' ? 'На графике — последние 30 дней. Нажми столбик для подробностей.' : 'Нажми столбик для подробностей.';
 const rows = deckTree().filter(d => !deck || descendantKeys(deck).has(d.key)).map(({key,depth}) => {
  const own = statisticsSnapshot(db,key,period), row=document.createElement('tr');
  const title=document.createElement('td');title.textContent=(depth ? '↳ ' : '')+deckName(key);title.style.paddingLeft=(8+Math.min(depth,3)*8)+'px';
  row.appendChild(title);
  for (const value of [own.cards.length,own.due,own.reviews.length]) { const cell=document.createElement('td');cell.textContent=value;row.appendChild(cell); }
  return row;
 });
 $('statsDeckRows').replaceChildren(...rows);
 $('statsDifficult').replaceChildren(...s.difficult.map(({card,misses}) => {
  const row=document.createElement('div');row.className='listitem';
  const word=document.createElement('div');word.innerHTML='<b>'+esc(card.word)+'</b><div class="small">'+esc(deckPath(card.deck))+'</div>';
  const count=document.createElement('span');count.className='pill';count.textContent='Повторить: '+misses;row.append(word,count);return row;
 }));
 if (!s.difficult.length) $('statsDifficult').innerHTML='<p class="small">Здесь появятся слова, для которых ты выбираешь «Повторить».</p>';
}
