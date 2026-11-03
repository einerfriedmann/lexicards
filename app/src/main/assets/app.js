'use strict';
// All runtime dependencies ship in the APK. Database changes become visible only
// after the IndexedDB transaction commits; failed imports never replace live data.
const DB_KEY = 'lexicards-sqlite-binary';
const DEFAULT_DECKS = ['Oxford 3000', 'My words'];
const MAX_FILE_SIZE = 25 * 1024 * 1024;
let SQL = null, sqlDb = null, db = {decks: [...DEFAULT_DECKS], cards: [], deckMeta:Object.create(null), reviews:[]};
let persistChain = Promise.resolve(), actionBusy = false, ready = false;
let current = null, queue = [], qIndex = 0, editing = null;
let studyDeck = '', deckQueue = [], deckIndex = 0, deckCurrent = null, activePage = 'home';
const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const due = c => !c.next || c.next <= Date.now();
const number = (v, fallback, min, max) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;
function text(v, limit = 20000) {
 const value = String(v ?? '');
 if (value.length > limit) throw new Error('Значение в карточке или названии длиннее ' + limit + ' символов.');
 return value;
}
function normalizeState(state) {
 if (!state || !Array.isArray(state.cards) || !Array.isArray(state.decks)) throw new Error('Неверная структура базы LexiCards.');
 if (state.cards.length > 100000) throw new Error('В базе больше 100 000 карточек.');
 const decks = [...new Set(state.decks.map(d => text(d, 200).trim()).filter(Boolean))];
 const ids = new Set();
 const cards = state.cards.map(raw => {
  const word = text(raw.word).trim(), translation = text(raw.translation).trim();
  if (!word || !translation) throw new Error('В базе есть карточка без слова или перевода.');
  const id = text(raw.id || uid(), 200);
  if (ids.has(id)) throw new Error('В базе повторяются идентификаторы карточек.');
  ids.add(id);
  const deck = text(raw.deck || 'My words', 200).trim() || 'My words';
  if (!decks.includes(deck)) decks.push(deck);
  return {id, word, translation, deck, ipa:text(raw.ipa), example:text(raw.example), exampleRu:text(raw.exampleRu),
   reps:Math.floor(number(raw.reps, 0, 0, 10000)), interval:number(raw.interval, 0, 0, 36500),
   ease:number(raw.ease ?? 2.5, 2.5, 1.3, 5), next:number(raw.next, 0, 0, 8640000000000000)};
 });
 const deckKeys = decks.length ? decks : [...DEFAULT_DECKS];
 return {decks:deckKeys,cards,deckMeta:normalizeDeckMeta(state,deckKeys),reviews:normalizeReviewHistory(state.reviews)};
}
function idbOpen() {
 return new Promise((resolve, reject) => {
  const r = indexedDB.open('LexiCardsStorage', 1);
  r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('db')) r.result.createObjectStore('db'); };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error || new Error('Хранилище недоступно.'));
  r.onblocked = () => reject(new Error('Закрой другие окна LexiCards и повтори запуск.'));
 });
}
async function idbGet() {
 const d = await idbOpen();
 return new Promise((resolve, reject) => {
  const tx = d.transaction('db', 'readonly'), r = tx.objectStore('db').get(DB_KEY);
  tx.oncomplete = () => { d.close(); resolve(r.result || null); };
  tx.onabort = tx.onerror = () => { d.close(); reject(tx.error || new Error('Не удалось прочитать базу.')); };
 });
}
async function idbPut(bytes) {
 const d = await idbOpen();
 return new Promise((resolve, reject) => {
  const tx = d.transaction('db', 'readwrite');
  tx.objectStore('db').put(bytes, DB_KEY);
  tx.oncomplete = () => { d.close(); resolve(); };
  tx.onabort = tx.onerror = () => { d.close(); reject(tx.error || new Error('Не удалось сохранить базу. Проверь свободное место.')); };
 });
}
function createDatabase(state) {
 state = normalizeState(state);
 const candidate = new SQL.Database();
 try {
  candidate.run('CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, label TEXT NOT NULL, parent_key TEXT)');
  candidate.run('CREATE TABLE reviews (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, deck_key TEXT NOT NULL, reviewed_at INTEGER NOT NULL, known INTEGER NOT NULL, interval_days REAL NOT NULL)');
  candidate.run('CREATE INDEX idx_reviews_date ON reviews(reviewed_at)');
  candidate.run("CREATE TABLE cards (id TEXT PRIMARY KEY, deck_name TEXT NOT NULL, word TEXT NOT NULL, translation TEXT NOT NULL, ipa TEXT DEFAULT '', example TEXT DEFAULT '', example_ru TEXT DEFAULT '', reps INTEGER DEFAULT 0, interval_days REAL DEFAULT 0, ease REAL DEFAULT 2.5, next_review INTEGER DEFAULT 0)");
  candidate.run('CREATE INDEX idx_cards_deck ON cards(deck_name)');
  candidate.run('BEGIN');
  const ds = candidate.prepare('INSERT INTO decks(name,label,parent_key) VALUES(?,?,?)');
  try { state.decks.forEach(d => ds.run([d,state.deckMeta[d].name,state.deckMeta[d].parent])); } finally { ds.free(); }
  const cs = candidate.prepare('INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  try { state.cards.forEach(c => cs.run([c.id,c.deck,c.word,c.translation,c.ipa,c.example,c.exampleRu,c.reps,c.interval,c.ease,c.next])); } finally { cs.free(); }
  const rs = candidate.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?)');
  try { state.reviews.forEach(r => rs.run([r.id,r.cardId,r.deck,r.at,r.known ? 1 : 0,r.interval])); } finally { rs.free(); }
  candidate.run('COMMIT'); return candidate;
 } catch (e) { candidate.close(); throw e; }
}
function readDatabase(source) {
 const tables = source.exec("SELECT name FROM sqlite_master WHERE type='table'");
 const names = tables.length ? tables[0].values.map(v => v[0]) : [];
 if (names.includes('cards')) {
  const columns = source.exec('PRAGMA table_info(cards)')[0].values.map(v => v[1]);
  for (const name of ['id','deck_name','word','translation','ipa','example','example_ru','reps','interval_days','ease','next_review']) {
   if (!columns.includes(name)) throw new Error('В базе нет поля cards.' + name + '. Импорт отменён.');
  }
  const result = source.exec('SELECT id,deck_name,word,translation,ipa,example,example_ru,reps,interval_days,ease,next_review FROM cards');
  const ds = names.includes('decks') ? source.exec('SELECT name FROM decks ORDER BY id') : [];
  const deckKeys = ds.length ? ds[0].values.map(v => v[0]) : [];
  const deckMeta = Object.create(null);
  if (names.includes('decks')) {
   const deckColumns = source.exec('PRAGMA table_info(decks)')[0].values.map(v => v[1]);
   if (deckColumns.includes('label') !== deckColumns.includes('parent_key')) throw new Error('Повреждена структура подколод.');
   if (deckColumns.includes('label')) {
    const metadata = source.exec('SELECT name,label,parent_key FROM decks');
    if (metadata.length) metadata[0].values.forEach(v => { deckMeta[v[0]] = {name:v[1],parent:v[2]}; });
   }
  }
  const history = names.includes('reviews') ? source.exec('SELECT id,card_id,deck_key,reviewed_at,known,interval_days FROM reviews') : [];
  return normalizeState({decks:deckKeys,deckMeta,reviews:history.length ? history[0].values.map(v => ({id:v[0],cardId:v[1],deck:v[2],at:v[3],known:v[4],interval:v[5]})) : [],
   cards:result.length ? result[0].values.map(v => ({id:v[0],deck:v[1],word:v[2],translation:v[3],ipa:v[4],example:v[5],exampleRu:v[6],reps:v[7],interval:v[8],ease:v[9],next:v[10]})) : []});
 }
 if (names.includes('app_state')) {
  const old = source.exec('SELECT payload FROM app_state WHERE id=1');
  if (old.length && old[0].values.length) return normalizeState(JSON.parse(old[0].values[0][0]));
 }
 throw new Error('Это не база LexiCards: таблица cards не найдена.');
}
async function commitState(state) {
 const normalized = normalizeState(state), candidate = createDatabase(normalized);
 try { await idbPut(candidate.export()); } catch (e) { candidate.close(); throw e; }
 const previous = sqlDb; sqlDb = candidate; db = normalized;
 if (previous) previous.close();
 $('sqliteStatus').textContent = 'Сохранено на устройстве: ' + db.cards.length + ' карточек.';
}
function mutateState(change) {
 const operation = persistChain.catch(() => {}).then(async () => {
  const next = clone(db); await change(next); await commitState(next); renderAll();
 });
 persistChain = operation; return operation;
}
async function perform(action) {
 if (!ready || actionBusy) return false;
 actionBusy = true;
 const buttons = Array.from(document.querySelectorAll('button')).map(b => [b,b.disabled]);
 buttons.forEach(([b]) => { b.disabled = true; });
 try { await action(); return true; }
 catch (e) { console.error(e); alert('Не удалось выполнить действие: ' + e.message + '\nТекущие данные сохранены без изменений.'); return false; }
 finally { actionBusy = false; buttons.forEach(([b,disabled]) => { b.disabled = disabled; }); }
}
async function bootstrap() {
 try {
  SQL = await initSqlJs({locateFile:file => 'vendor/' + file});
  const bytes = await idbGet();
  if (bytes) {
   const existing = new SQL.Database(new Uint8Array(bytes));
   try { db = readDatabase(existing); sqlDb = existing; } catch (e) { existing.close(); throw e; }
  } else { await commitState(db); }
  ready = true; ensureNav(); initializeUI(); renderAll(); initializeCapture(); show('home'); receiveSharedTextFromNative();
  $('sqliteStatus').textContent = 'SQLite готова. Автоматическое сохранение на устройстве.';
 } catch (e) {
  console.error(e);
  const panel = document.createElement('div'); panel.className = 'panel'; panel.id = 'startupError';
  panel.innerHTML = '<h2>Не удалось открыть библиотеку</h2><p>' + esc(e.message) + '</p><p>Существующие данные не перезаписаны. Проверь свободное место и перезапусти приложение.</p>';
  document.querySelector('main').prepend(panel);
  document.querySelectorAll('main>section').forEach(s => s.classList.add('hidden'));
 }
}
function stopSpeech() {
 if (window.AndroidBridge && AndroidBridge.stopSpeech) AndroidBridge.stopSpeech();
 else if ('speechSynthesis' in window) speechSynthesis.cancel();
}
function show(id) {
 const previous = activePage;
 if (id !== activePage) stopSpeech();
 document.querySelectorAll('main>section').forEach(s => s.classList.toggle('hidden', s.id !== id));
 activePage = id;
 document.querySelectorAll('nav button').forEach(b => { const selected=b.dataset.page===id;b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current'); });
 if (id === 'add') fillDeckSelect();
 if (id === 'stats') renderStatistics();
 updateUIPage(id,previous);
}
function handleAndroidBack() {
 if (pendingSharedRequest) { dismissSharedText(); return true; }
 const dialog = document.querySelector('dialog[open]'); if(dialog) { dialog.close(); return true; }
 if (!mainPages.includes(activePage)) { leaveFocus(); return true; }
 if (activePage === 'home') return false;
 show('home'); return true;
}
function ensureNav() {
 const n=$('bottomNav');if(n.children.length)return;
 for(const [id,label,name] of [['home','Главная','home'],['library','Карточки','cards'],['decks','Колоды','folder'],['stats','Прогресс','chart'],['settings','Данные','settings']]){
  const b=document.createElement('button');b.dataset.page=id;b.innerHTML=icon(name);const span=document.createElement('span');span.textContent=label;b.appendChild(span);b.onclick=()=>show(id);n.appendChild(b);
 }
}
function makeButton(label, action, kind = 'secondary fit') {
 const b = document.createElement('button'); b.className = kind; b.textContent = label; b.onclick = action; return b;
}
function deckRow(key,editable) { return editable ? buildDeckNode(key) : buildHomeDeck(key); }
function renderAll() {
 $('total').textContent = db.cards.length;
 $('due').textContent = db.cards.filter(due).length;
 const known = db.cards.filter(c => c.reps >= 2).length;
 $('known').textContent = known;
 $('progressText').textContent = db.cards.length ? known + ' из ' + db.cards.length + ' слов уже закрепляются' : 'Добавь первую карточку';
 $('progressBar').style.width = (db.cards.length ? known / db.cards.length * 100 : 0) + '%';
 renderDeckTree('deckHome',false); renderDeckTree('deckList',true);
 fillHierarchyFilter('libraryDeckFilter'); fillHierarchyFilter('statsDeck');
 renderLibrary(); fillDeckSelect(); renderHomeSummary(); if (activePage==='stats') renderStatistics();
}
function renderLibrary() {
 const term=$('search').value.toLowerCase().trim(),filter=$('libraryDeckFilter').value,scope=filter?descendantKeys(filter):null;
 const cards=db.cards.filter(c=>(!scope||scope.has(c.deck))&&(libraryStatus!=='due'||due(c))&&(libraryStatus!=='known'||c.reps>=2)&&(c.word+' '+c.translation).toLowerCase().includes(term));
 $('clearSearch').classList.toggle('hidden',!$('search').value);$('libraryResultCount').textContent=cards.length+' карточек'+(filter?' · '+deckPath(filter):'');
 const elements=cards.map(c=>{
  const row=document.createElement('div');row.className='listitem library-card';
  const main=document.createElement('button');main.className='library-card-main';main.setAttribute('aria-label','Редактировать '+c.word);main.onclick=()=>editCard(c.id);
  main.innerHTML='<b>'+esc(c.word)+'</b><span class="card-translation">'+esc(c.translation)+'</span><span class="card-location">'+esc(deckPath(c.deck))+'</span>';
  const actions=document.createElement('div');actions.className='library-card-actions';
  actions.append(iconButton('sound','Произнести '+c.word,()=>speakFallback(c.word,'us')),iconButton('more','Действия с карточкой '+c.word,()=>openCardActions(c.id)));
  row.append(main,actions);return row;
 });
 $('cardList').replaceChildren(...elements);
 if(!elements.length){
  const empty=document.createElement('div');empty.className='empty';
  empty.innerHTML='<span class="empty-icon">'+icon(term?'search':'cards')+'</span><h2>'+(!db.cards.length?'Твой словарь начинается здесь.':term?'Ничего не нашлось.':'Здесь пока пусто.')+'</h2><p>'+(!db.cards.length?'Добавь слово вручную или отправь его<br>из другого приложения через «Поделиться».':term?'Попробуй другое слово или перевод.':'Попробуй выбрать другую колоду или фильтр.')+'</p>';
  const button=makeButton(!db.cards.length?'Добавить первое слово':'Сбросить фильтры',()=>{if(!db.cards.length)openNewCard();else{$('search').value='';$('libraryDeckFilter').value='';setLibraryStatus('all');}},'primary-button');empty.appendChild(button);$('cardList').appendChild(empty);
 }
}
function fillDeckSelect() {
 const select = $('fDeck'), previous = select.value;
 select.replaceChildren(...deckTree().map(d => { const o = deckOption(d.key,d.depth); o.textContent = deckPath(d.key); return o; }));
 if (db.decks.includes(previous)) select.value = previous;
}
function resetForm() {
 editing = null;
 ['fWord','fTranslation','fIpa','fExample','fExampleRu'].forEach(id => { $(id).value = ''; });
 $('formTitle').textContent = 'Новая карточка';
 clearFormError(); $('optionalCardFields').open=false;
 clearCaptureDraft();
}
function editCard(id) {
 const c = db.cards.find(x => x.id === id); if (!c || !canOpenCardEdit(id)) return;
 if (captureEnvelope().draft?.editing === id) { resumeCardDraft(); return; }
 editing = id; show('add'); $('formTitle').textContent = 'Изменить карточку';
 for (const [field,key] of [['fWord','word'],['fTranslation','translation'],['fIpa','ipa'],['fExample','example'],['fExampleRu','exampleRu']]) $(field).value = c[key] || '';
 $('fDeck').value = c.deck;
 $('optionalCardFields').open=!!(c.ipa||c.exampleRu);clearFormError();
 rememberCardDraft();
}
function saveCard() {
 const fields = {word:$('fWord').value.trim(),translation:$('fTranslation').value.trim(),ipa:$('fIpa').value.trim(),example:$('fExample').value.trim(),exampleRu:$('fExampleRu').value.trim(),deck:$('fDeck').value};
 if (!validateCardForm(fields)) return;
 const editId = editing;
 return perform(async () => {
  await mutateState(next => {
   if (editId) {
    const c = next.cards.find(c => c.id === editId); if (!c) throw new Error('Карточка уже удалена.');
    Object.assign(c,fields); // Keep the existing review schedule on an edit.
   } else next.cards.push({id:uid(),...fields,reps:0,interval:0,ease:2.5,next:0});
  });
  resetForm(); show('library'); showToast(editId?'Карточка обновлена':'Карточка добавлена');
 });
}
function deleteCard(id) {
 if (!confirm('Удалить эту карточку?')) return;
 return perform(async () => { await mutateState(next => { next.cards = next.cards.filter(c => c.id !== id); }); showToast('Карточка удалена'); });
}

function startReview() {
 if (!ready || actionBusy) return;
 stopSpeech(); queue = db.cards.filter(due).sort((a,b) => a.next - b.next).map(c => c.id); qIndex = 0; current = null;
 show('review'); drawReview();
}
function drawReview() {
 current = null;
 while (qIndex < queue.length && !db.cards.some(c => c.id === queue[qIndex])) qIndex++;
 const c = db.cards.find(c => c.id === queue[qIndex]);
 $('reviewCount').textContent = (c ? qIndex + 1 : queue.length) + ' / ' + queue.length;
 $('reviewCard').classList.toggle('hidden',!c); $('reviewEmpty').classList.toggle('hidden',!!c);$('reviewControls').classList.toggle('hidden',!c);$('reviewProgress').style.width=(queue.length?qIndex/queue.length*100:100)+'%';
 if (!c) {
  renderReviewCompletion(); return;
 }
 current = c; $('frontWord').textContent = c.word; $('frontIpa').textContent=c.ipa||'';$('frontIpa').classList.toggle('hidden',!c.ipa);$('reviewNextInterval').textContent=nextIntervalLabel(c);
 $('answer').classList.add('hidden'); $('rateBtns').classList.add('hidden'); $('revealBtn').classList.remove('hidden');
}
function reveal() {
 if (!current) return;
 $('backTranslation').textContent = current.translation; $('backExample').textContent = current.example || 'Пример пока не добавлен.';
 $('backNote').textContent = current.exampleRu; $('reviewSpeakExample').classList.toggle('hidden',!current.example.trim());
 $('answer').classList.remove('hidden'); $('rateBtns').classList.remove('hidden'); $('revealBtn').classList.add('hidden');
}
function schedule(c, known) {
 if (known) {
  c.reps++; c.interval = c.reps === 1 ? 1 : c.reps === 2 ? 3 : Math.min(36500,Math.round((c.interval || 3) * c.ease));
  c.ease = Math.min(5,c.ease + 0.1); c.next = Date.now() + c.interval * 86400000;
 } else { c.reps = 0; c.interval = 0; c.ease = Math.max(1.3,c.ease - 0.2); c.next = Date.now() + 10 * 60000; }
}
function rate(known) {
 if (!current || $('rateBtns').classList.contains('hidden')) return;
 const id = current.id;
 return perform(async () => {
  await mutateState(next => { const c = next.cards.find(c => c.id === id); if (c) { schedule(c,known); next.reviews.push({id:uid(),cardId:c.id,deck:c.deck,at:Date.now(),known:!!known,interval:c.interval}); } });
  stopSpeech(); qIndex++; drawReview();
 });
}
function openDeck(name) {
 if (!ready || actionBusy) return;
 stopSpeech(); studyDeck = name; deckQueue = db.cards.filter(c => descendantKeys(name).has(c.deck)).sort((a,b) => a.next - b.next).map(c => c.id);
 deckIndex = 0; deckCurrent = null; $('deckStudyTitle').textContent = 'Тренировка · ' + deckPath(name);
 show('deckStudy'); drawDeckWord();
}
function drawDeckWord() {
 deckCurrent = null;
 while (deckIndex < deckQueue.length && !db.cards.some(c => c.id === deckQueue[deckIndex])) deckIndex++;
 const c = db.cards.find(c => c.id === deckQueue[deckIndex]);
 $('deckStudyCount').textContent = (c ? deckIndex + 1 : deckQueue.length) + ' / ' + deckQueue.length;
 $('deckProgress').style.width=(deckQueue.length?deckIndex/deckQueue.length*100:100)+'%';
 $('deckTools').classList.toggle('hidden',!c); $('deckEmpty').classList.toggle('hidden',!!c);
 $('deckAnswer').classList.add('hidden'); $('deckRates').classList.add('hidden'); $('deckReveal').classList.toggle('hidden',!c);
 if(!c){$('deckEmpty').innerHTML='<span class="empty-icon">'+icon(deckQueue.length?'check-circle':'folder')+'</span><h2>'+(deckQueue.length?'Колода завершена.':'Пока нет слов.')+'</h2><p>'+(deckQueue.length?'Ты разобрал все карточки этой сессии.':'Добавь первое слово в свою коллекцию.')+'</p><button class="primary-button" onclick="leaveFocus()">К колодам</button>';return;}
 deckCurrent = c; $('deckCardLocation').textContent = deckPath(c.deck); $('deckWord').textContent = c.word; $('deckIpa').textContent=c.ipa||'';$('deckIpa').classList.toggle('hidden',!c.ipa);$('deckNextInterval').textContent=nextIntervalLabel(c);
 $('deckTranslation').textContent = c.translation; $('deckExample').textContent = c.example || 'Пример пока не добавлен.';
 $('speakExampleBtn').classList.toggle('hidden',!c.example.trim()); $('deckExampleRu').textContent = c.exampleRu;
}
function revealDeckWord() {
 if (!deckCurrent) return;
 $('deckAnswer').classList.remove('hidden'); $('deckRates').classList.remove('hidden'); $('deckReveal').classList.add('hidden');
}
function rateDeckWord(known) {
 if (!deckCurrent || $('deckRates').classList.contains('hidden')) return;
 const id = deckCurrent.id;
 return perform(async () => {
  await mutateState(next => { const c = next.cards.find(c => c.id === id); if (c) { schedule(c,known); next.reviews.push({id:uid(),cardId:c.id,deck:c.deck,at:Date.now(),known:!!known,interval:c.interval}); } });
  stopSpeech(); deckIndex++; drawDeckWord();
 });
}
function openYouGlish(word,accent) {
 const target = String(word || (deckCurrent && deckCurrent.word) || '').trim(); if (!target) return;
 const dialect = accent || $('ygAccent').value || 'uk';
 const url = 'https://youglish.com/pronounce/' + encodeURIComponent(target) + '/english/' + (dialect === 'us' ? 'us' : 'uk');
 if (window.AndroidBridge && AndroidBridge.openExternalUrl) AndroidBridge.openExternalUrl(url);
 else window.open(url,'_blank','noopener,noreferrer');
}
function speakFallback(word,accent) {
 if (window.AndroidBridge && AndroidBridge.speakText) { AndroidBridge.speakText(String(word),accent === 'uk' ? 'en-GB' : 'en-US'); return; }
 if (!('speechSynthesis' in window)) { alert('Синтез речи недоступен. Открой LexiCards в Android-приложении.'); return; }
 speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(word); u.lang = accent === 'uk' ? 'en-GB' : 'en-US';
 const voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase() === u.lang.toLowerCase()); if (voice) u.voice = voice;
 speechSynthesis.speak(u);
}
function playDictionaryAudio(accent) { if (deckCurrent) speakFallback(deckCurrent.word,accent); }
function speakDeckExample() { if (deckCurrent && deckCurrent.example.trim()) speakFallback(deckCurrent.example,$('ygAccent').value); }
function speakReviewExample() { if (current && current.example.trim()) speakFallback(current.example,'us'); }
function speakCurrent(accent='us') { if (current) speakFallback(current.word,accent); }
function youglishCurrent() { if (current) openYouGlish(current.word,'us'); }
function openTtsSettings() {
 if (window.AndroidBridge && AndroidBridge.openTtsSettings) AndroidBridge.openTtsSettings();
 else alert('В Android-приложении эта кнопка открывает настройки синтеза речи.');
}
function resetSessions() { current = deckCurrent = null; queue = []; deckQueue = []; qIndex = deckIndex = 0; resetForm(); stopSpeech(); }
function resetAllData() {
 if (!confirm('Удалить все карточки и колоды? Сначала сделай экспорт CSV или SQLite.')) return;
 return perform(async () => { await mutateState(next => { next.decks = [...DEFAULT_DECKS]; next.cards = []; next.deckMeta = Object.create(null); next.reviews = []; }); resetSessions(); show('home'); });
}
// RFC 4180 quoting, with common semicolon and tab delimited deck support.
function parseCSV(input) {
 const t = String(input).replace(/^\ufeff/,'');
 let quoted = false, counts = {',':0,';':0,'\t':0};
 for (let i = 0; i < t.length; i++) {
  if (t[i] === '"') { if (quoted && t[i+1] === '"') { i++; continue; } quoted = !quoted; }
  else if (!quoted) { if (t[i] === '\r' || t[i] === '\n') break; if (t[i] in counts) counts[t[i]]++; }
 }
 const separator = Object.keys(counts).sort((a,b) => counts[b]-counts[a])[0];
 const rows = []; let row = [], value = '', q = false;
 for (let i = 0; i < t.length; i++) {
  const c = t[i];
  if (q && c === '"' && t[i+1] === '"') { value += '"'; i++; }
  else if (c === '"') q = !q;
  else if (c === separator && !q) { row.push(value); value = ''; }
  else if ((c === '\n' || c === '\r') && !q) {
   if (c === '\r' && t[i+1] === '\n') i++;
   row.push(value); if (row.some(v => v.trim())) rows.push(row); row = []; value = '';
  } else value += c;
 }
 if (q) throw new Error('В CSV не закрыта кавычка.');
 if (value || row.length) { row.push(value); if (row.some(v => v.trim())) rows.push(row); }
 return rows;
}
function csvCards(content, forcedDeck) {
 const rows = parseCSV(content); if (!rows.length) return {cards:[],skipped:0};
 const headers = rows.shift().map(h => h.trim().toLowerCase());
 if (!headers.some(h => ['word','term','front','english'].includes(h)) || !headers.some(h => ['translation','meaning','back','russian'].includes(h))) throw new Error('В CSV нужны столбцы word и translation (или front и back).');
 let skipped = 0;
 const cards = [], paths = [];
 for (const row of rows) {
  const o = Object.create(null); headers.forEach((h,i) => { o[h] = (row[i] || '').trim(); });
  const word = o.word || o.term || o.front || o.english, translation = o.translation || o.meaning || o.back || o.russian;
  if (!word || !translation) { skipped++; continue; }
  let path = null;
  if (!forcedDeck && o.deckpath) { path = JSON.parse(o.deckpath); if (!Array.isArray(path) || !path.length || path.length>17 || path.some(p => typeof p!=='string'||!p.trim()||p.length>200)) throw new Error('Неверный путь колоды в CSV.'); }
  paths.push(path);
  cards.push({id:uid(),word,translation,ipa:o.ipa || o.transcription || '',example:o.example || '',exampleRu:o.exampleru || o.example_ru || o.example_translation || '',deck:forcedDeck || o.deck || 'Imported',reps:o.reps || 0,interval:o.interval || 0,ease:o.ease || 2.5,next:o.next || 0});
 }
 return {cards:normalizeState({decks:[],cards}).cards.map((c,i) => paths[i] ? {...c,importPath:paths[i]} : c),skipped};
}
function fingerprint(c) { return JSON.stringify([c.deck,c.word,c.translation,c.ipa,c.example,c.exampleRu]); }
async function appendCards(cards) {
 let added = 0, duplicates = 0;
 await mutateState(next => {
  const existing = new Set(next.cards.map(fingerprint));
  for (const raw of cards) {
   const c = {...raw};
   c.deck = ensureDeckPath(next,c.importPath || [c.deck]); delete c.importPath;
   const key = fingerprint(c); if (existing.has(key)) { duplicates++; continue; }
   existing.add(key); next.cards.push(c); if (!next.decks.includes(c.deck)) next.decks.push(c.deck); added++;
  }
 });
 return {added,duplicates};
}
function checkFile(file) { if (file.size > MAX_FILE_SIZE) throw new Error('Файл больше 25 МБ. Раздели его на несколько файлов.'); }
async function importCSV(event) {
 const file = event.target.files[0]; event.target.value = ''; if (!file) return;
 return perform(async () => {
  checkFile(file); const parsed = csvCards(await file.text());
  const result = await appendCards(parsed.cards);
  alert('Добавлено: ' + result.added + '. Дубликатов: ' + result.duplicates + '. Пропущено строк: ' + parsed.skipped + '.');
 });
}
function exportCSV() {
 return perform(async () => {
  await persistChain;
  const headers = ['word','translation','ipa','example','exampleRu','deck','reps','interval','ease','next','deckPath'];
  const rows = [headers,...db.cards.map(c => headers.map(k => k==='deck' ? deckName(c.deck) : k==='deckPath' ? JSON.stringify(deckAncestors(c.deck).map(d => deckName(d))) : c[k]))];
  const csv = '\ufeff' + rows.map(row => row.map(v => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(',')).join('\r\n');
  await saveBlobToDevice(new Blob([csv],{type:'text/csv'}),'lexicards-backup.csv','text/csv');
 });
}
function saveBlobToDevice(blob,filename,mime) {
 if (blob.size > MAX_FILE_SIZE) return Promise.reject(new Error('Экспорт больше 25 МБ. Экспортируй базу SQLite.'));
 if (window.AndroidBridge && AndroidBridge.saveFile) {
  return new Promise((resolve,reject) => {
   const reader = new FileReader(); reader.onerror = () => reject(reader.error);
   reader.onload = () => { AndroidBridge.saveFile(filename,mime,String(reader.result).split(',')[1] || ''); resolve(); };
   reader.readAsDataURL(blob);
  });
 }
 const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click();
 setTimeout(() => URL.revokeObjectURL(url),1000); return Promise.resolve();
}
function exportSQLite() {
 return perform(async () => { await persistChain; await saveBlobToDevice(new Blob([sqlDb.export()],{type:'application/vnd.sqlite3'}),'lexicards.sqlite','application/vnd.sqlite3'); });
}
async function importSQLite(event) {
 const file = event.target.files[0]; event.target.value = ''; if (!file) return;
 return perform(async () => {
  checkFile(file); const imported = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  let state; try { state = readDatabase(imported); } finally { imported.close(); }
  if (!confirm('Заменить текущую библиотеку? В файле ' + state.cards.length + ' карточек. Текущие карточки будут заменены.')) return;
  await mutateState(next => { next.decks = state.decks; next.cards = state.cards; next.deckMeta = state.deckMeta; next.reviews = state.reviews; });
  resetSessions(); show('settings'); alert('База восстановлена. Карточек: ' + db.cards.length);
 });
}
function chooseCsvFolder() {
 if (window.AndroidBridge && AndroidBridge.chooseCsvFolder) AndroidBridge.chooseCsvFolder();
 else $('folderFiles').click();
}
async function importCsvFilesFromNative(files, nativeErrors = []) {
 return perform(async () => {
  const cards = [], errors = [...nativeErrors]; let skipped = 0, count = 0;
  for (const file of files || []) {
   try {
    const parsed = csvCards(String(file.content || ''), String(file.name || 'Колода').replace(/\.csv$/i,''));
    cards.push(...parsed.cards); skipped += parsed.skipped; count++;
   } catch (e) { errors.push(String(file.name) + ': ' + e.message); }
  }
  const result = await appendCards(cards);
  const status = 'CSV-файлов: ' + count + '. Добавлено: ' + result.added + '. Дубликатов: ' + result.duplicates + '. Пропущено строк: ' + skipped + '. Ошибок: ' + errors.length + '.';
  $('folderStatus').textContent = status;
  alert(status + (errors.length ? '\n' + errors.slice(0,5).join('\n') : ''));
 });
}
function receiveNativeCsv() {
 if (!ready || actionBusy) { setTimeout(receiveNativeCsv,250); return; }
 try {
  const payload = JSON.parse(AndroidBridge.takeCsvFiles());
  return importCsvFilesFromNative(payload.files || [],payload.errors || []);
 } catch (e) { alert('Не удалось прочитать папку: ' + e.message); }
}
async function importFolder(event) {
 const files = Array.from(event.target.files || []).filter(f => /\.csv$/i.test(f.name)); event.target.value = '';
 if (!files.length) { $('folderStatus').textContent = 'CSV-файлы не найдены.'; return; }
 const contents = [], errors = []; let total = 0;
 for (const file of files) {
  try { checkFile(file); total += file.size; if (total > MAX_FILE_SIZE) throw new Error('Общий размер папки больше 25 МБ.'); contents.push({name:file.name,content:await file.text()}); }
  catch (e) { errors.push(file.name + ': ' + e.message); }
 }
 return importCsvFilesFromNative(contents,errors);
}
window.addEventListener('pagehide',stopSpeech);
bootstrap();
