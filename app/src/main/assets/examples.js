'use strict';
// The list is canonical; example/exampleRu remain aliases of the first item for
// older CSV readers. Old single-example cards migrate without changing reviews.
function cardExamples(card) {
 const source=card.examples==null ? [{text:card.example||'',translation:card.exampleRu||''}] : card.examples;
 if(!Array.isArray(source))throw new Error('Неверный список примеров.');
 const ids=new Set();
 return source.map((item,index)=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Повреждён пример в карточке.');
  const id=text(item.id||'example-'+index,200),phrase=text(item.text),translation=text(item.translation);
  if(ids.has(id))throw new Error('В карточке повторяются идентификаторы примеров.');
  ids.add(id);return {id,text:phrase,translation};
 }).filter(item=>item.text.trim()||item.translation.trim());
}
let editorFirstExampleId='example-0',editorExamplesBase=[];
function additionalEditorExamples() {
 return Array.from($('additionalExamples').children,row=>({id:row.dataset.exampleId,text:row.querySelector('[data-example-text]').value,translation:row.querySelector('[data-example-translation]').value}));
}
function editorExamples() {
 return cardExamples({examples:[{id:editorFirstExampleId,text:$('fExample').value,translation:$('fExampleRu').value},...additionalEditorExamples()]});
}
function renderAdditionalExamples(examples=[]) {
 $('additionalExamples').replaceChildren();for(const item of examples)appendExampleEditorRow(item,false);
}
function appendExampleEditorRow(item={id:uid(),text:'',translation:''},focus=true) {
 const row=document.createElement('div');row.className='extra-example';row.dataset.exampleId=item.id||uid();
 const heading=document.createElement('div');heading.className='row';const title=document.createElement('b');title.className='extra-example-title';heading.appendChild(title);
 const remove=iconButton('trash','Удалить пример',()=>{row.remove();renumberExampleEditor();rememberCardDraft();});heading.appendChild(remove);
 const phraseId='example-text-'+uid(),noteId='example-note-'+uid();
 const label=document.createElement('label');label.htmlFor=phraseId;label.textContent='Фраза на английском';
 const phrase=document.createElement('textarea');phrase.id=phraseId;phrase.dataset.exampleText='';phrase.maxLength=20000;phrase.placeholder='Твой пример с этим словом';phrase.value=item.text||'';
 const noteLabel=document.createElement('label');noteLabel.htmlFor=noteId;noteLabel.textContent='Перевод — необязательно';
 const note=document.createElement('textarea');note.id=noteId;note.dataset.exampleTranslation='';note.maxLength=20000;note.value=item.translation||'';note.rows=2;
 row.append(heading,label,phrase,noteLabel,note);$('additionalExamples').appendChild(row);renumberExampleEditor();
 if(focus){rememberCardDraft();phrase.focus();}
}
function renumberExampleEditor() {
 Array.from($('additionalExamples').children).forEach((row,i)=>{row.querySelector('b').textContent='Пример '+(i+2);row.querySelector('button').setAttribute('aria-label','Удалить пример '+(i+2));});
}
function restoreExampleEditorFields(fields) {
 editorFirstExampleId=fields.firstExampleId||'example-0';
 editorExamplesBase=fields.exampleBase||cardExamples({example:fields.example,exampleRu:fields.exampleRu});
 renderAdditionalExamples(fields.additionalExamples||[]);
}
function mergeExampleEdits(base,edited,latest) {
 const original=new Set(base.map(e=>e.id)),included=new Set(edited.map(e=>e.id));
 return [...edited,...latest.filter(e=>!original.has(e.id)&&!included.has(e.id))];
}
const exampleViews={review:{cardId:null,index:0},deck:{cardId:null,index:0}};
function exampleCard(scope) { const id=scope==='review'?current?.id:deckCurrent?.id;return db.cards.find(c=>c.id===id); }
function renderExamples(scope,card,index) {
 const view=exampleViews[scope],items=cardExamples(card);
 if(view.cardId!==card.id){view.cardId=card.id;view.index=0;}
 if(index!==undefined)view.index=index;
 view.index=Math.max(0,Math.min(view.index,items.length-1));
 const item=items[view.index],review=scope==='review';
 $(review?'backExample':'deckExample').textContent=item?.text||'Пример пока не добавлен.';
 $(review?'backNote':'deckExampleRu').textContent=item?.translation||'';
 $(review?'reviewSpeakExample':'speakExampleBtn').classList.toggle('hidden',!item?.text.trim());
 $(scope+'ExampleCounter').textContent=items.length?(view.index+1)+' / '+items.length:'Нет примеров';
 $(scope+'ExamplePrev').disabled=view.index===0;
 $(scope+'ExampleNext').disabled=view.index>=items.length-1;
 $(scope+'SwipeHint').classList.toggle('hidden',items.length<2);
 $(scope+'AddExample').textContent=readExampleDraft(card.id)?'Продолжить свой пример':'+ Свой пример';
}
function changeExample(scope,direction) {
 const card=exampleCard(scope);if(!card)return;
 stopSpeech();renderExamples(scope,card,exampleViews[scope].index+direction);
}
function speakSelectedExample(scope) {
 const card=exampleCard(scope);if(!card)return;
 const item=cardExamples(card)[exampleViews[scope].index];if(item?.text.trim())speakFallback(item.text,scope==='review'?'us':$('ygAccent').value);
}
function initializeExamples() {
 for(const scope of ['review','deck']){
  const panel=$(scope+'Examples');let start=null;
  panel.addEventListener('pointerdown',event=>{
   start=null;if(event.isPrimary===false||event.button!==0||event.target.closest('button'))return;
   start={x:event.clientX,y:event.clientY,id:event.pointerId};
  });
  panel.addEventListener('pointerup',event=>{
   const from=start;start=null;if(!from||from.id!==event.pointerId)return;
   const x=event.clientX-from.x,y=event.clientY-from.y;
   if(Math.abs(x)>=48&&Math.abs(x)>Math.abs(y)*1.5&&!window.getSelection()?.toString())changeExample(scope,x<0?1:-1);
  });
  panel.addEventListener('pointercancel',()=>{start=null;});
  panel.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();changeExample(scope,event.key==='ArrowLeft'?-1:1);}});
 }
 $('exampleComposer').addEventListener('close',()=>{
  const advance=exampleComposer?.advance;exampleComposer=null;if(advance)advance();renderExampleDraftResume();
 });
 for(const id of ['newExampleText','newExampleTranslation'])$(id).addEventListener('input',rememberExampleDraft);
 renderExampleDraftResume();
}
const EXAMPLE_DRAFT_PREFIX='lexicards-example-draft-v1:';
let exampleComposer=null;
function readExampleDraft(cardId) {
 try{const value=JSON.parse(localStorage.getItem(EXAMPLE_DRAFT_PREFIX+cardId)||'null');return value&&typeof value.id==='string'&&typeof value.text==='string'&&typeof value.translation==='string'?value:null;}catch{return null;}
}
function renderExampleDraftResume() {
 let latest=null;
 try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key.startsWith(EXAMPLE_DRAFT_PREFIX))continue;
  const card=db.cards.find(c=>c.id===key.slice(EXAMPLE_DRAFT_PREFIX.length));if(!card)continue;
  const draft=readExampleDraft(card.id);if(draft&&(draft.text.trim()||draft.translation.trim())&&!cardExamples(card).some(e=>e.id===draft.id)&&(!latest||draft.at>latest.at))latest={...draft,cardId:card.id,word:card.word};
 }}catch{/* Draft discovery must not block opening the library. */}
 $('resumeExamplePanel').classList.toggle('hidden',!latest);
 if(latest){$('resumeExampleLabel').textContent=latest.word;$('resumeExampleButton').onclick=()=>openExampleComposer(latest.cardId);}
}
function openExampleComposer(cardId,advance=null) {
 if(exampleComposer||!db.cards.some(c=>c.id===cardId))return false;
 const card=db.cards.find(c=>c.id===cardId),draft=readExampleDraft(cardId);
 exampleComposer={cardId,id:draft?.id||uid(),advance};
 $('exampleComposerTitle').textContent='Своя фраза для «'+card.word+'»';
 $('exampleComposerHint').textContent=advance?'Ответ сохранён. Добавь пример для закрепления или переходи дальше.':'Добавь ещё одну фразу с этим словом.';
 $('newExampleText').value=draft?.text||'';$('newExampleTranslation').value=draft?.translation||'';
 $('exampleComposerError').textContent='';$('exampleDraftStatus').textContent=draft?'Черновик восстановлен.':'';
 $('exampleComposerSkip').textContent=advance?'Дальше без примера':'Закрыть';
 stopSpeech();$('exampleComposer').showModal();$('newExampleText').focus();return true;
}
function addStudyExample(scope) { const card=exampleCard(scope);if(card)openExampleComposer(card.id); }
function rememberExampleDraft() {
 if(!exampleComposer)return;
 const {cardId,id}=exampleComposer;
 try{
  const draft={id,text:$('newExampleText').value,translation:$('newExampleTranslation').value,at:Date.now()};
  if(draft.text.trim()||draft.translation.trim())localStorage.setItem(EXAMPLE_DRAFT_PREFIX+cardId,JSON.stringify(draft));
  else localStorage.removeItem(EXAMPLE_DRAFT_PREFIX+cardId);
  $('exampleDraftStatus').textContent='Черновик сохранён на устройстве.';$('exampleComposerError').textContent='';
 }catch(e){$('exampleComposerError').textContent='Черновик не сохранён: '+e.message;}
}
async function saveStudyExample() {
 if(!exampleComposer)return;
 const context=exampleComposer,phrase=$('newExampleText').value.trim(),translation=$('newExampleTranslation').value.trim();
 if(!phrase){$('exampleComposerError').textContent='Напиши фразу с этим словом.';$('newExampleText').focus();return;}
 const success=await perform(async()=>{
  await mutateState(next=>{
   const card=next.cards.find(c=>c.id===context.cardId);if(!card)throw new Error('Карточка уже удалена.');
   const items=cardExamples(card);if(!items.some(e=>e.id===context.id))items.push({id:context.id,text:phrase,translation});card.examples=items;
  });
 },{onError:e=>{$('exampleComposerError').textContent='Пример не сохранён: '+e.message;}});
 if(!success)return;
 try{localStorage.removeItem(EXAMPLE_DRAFT_PREFIX+context.cardId);}catch{/* Stable example IDs prevent duplicate saves if draft cleanup fails. */}
 const card=db.cards.find(c=>c.id===context.cardId);
 for(const scope of ['review','deck'])if(exampleCard(scope)?.id===card.id)renderExamples(scope,card,card.examples.length-1);
 $('exampleComposer').close();showToast('Пример добавлен');
}

function clearExampleDrafts() {
 try{const keys=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith(EXAMPLE_DRAFT_PREFIX))keys.push(key);}for(const key of keys)localStorage.removeItem(key);}catch{showToast('Не удалось очистить черновики примеров');}
 renderExampleDraftResume();
}
