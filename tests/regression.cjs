const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({chromium} = require('playwright')); }
catch { ({chromium} = require('/opt/codex/cua_node/lib/node_modules/playwright-core')); }
const assets = path.resolve(__dirname,'../app/src/main/assets');
const output = path.resolve(__dirname,'../test-results'); fs.mkdirSync(output,{recursive:true});
const server = {close() {}};
(async () => {
 const url = 'https://lexicards.test';
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,timezoneId:'Europe/Berlin'});
 // Abort every non-bundled request: first launch must work with no external network.
 const external = [];
 await context.route('**/*',route => {
  if (route.request().url().startsWith(url+'/')) {
   const pathname=decodeURIComponent(new URL(route.request().url()).pathname);
   const file=path.resolve(assets,'.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(assets+path.sep))return route.fulfill({status:403,body:''});
   try {const body=fs.readFileSync(file);return route.fulfill({status:200,contentType:file.endsWith('.wasm')?'application/wasm':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body});}
   catch{return route.fulfill({status:404,body:''});}
  }
  external.push(route.request().url()); return route.abort();
 });
 const page = await context.newPage(); const pageErrors = []; const alerts = []; let confirmation = true;
 page.on('pageerror',e => pageErrors.push(e.message));
 page.on('dialog',async dialog => {
  alerts.push(dialog.message());
  if (dialog.type() === 'confirm' && !confirmation) await dialog.dismiss();
  else await dialog.accept();
 });
 const passed = [];
 async function check(name,fn) { await fn(); passed.push(name); console.log('PASS',name); }
 async function idle() { await page.waitForFunction(() => ready && !actionBusy); }
 async function state() { return page.evaluate(() => clone(db)); }
 async function inputCSV(csv) {
  await page.locator('#csvFile').setInputFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from(csv)}); await idle();
 }
 async function inputSQLite(bytes) {
  await page.locator('#sqliteFile').setInputFiles({name:'test.sqlite',mimeType:'application/octet-stream',buffer:Buffer.from(bytes)}); await idle();
 }
 try {
  await page.goto(url+'/'); await idle();
  await check('first launch: bundled SQLite, no external requests',async () => { assert.equal((await state()).cards.length,0); assert.deepEqual(external,[]); });
  await check('create card through UI',async () => {
   await page.evaluate(() => { resetForm(); show('add'); });
   await page.locator('#fWord').fill('abandon'); await page.locator('#fTranslation').fill('бросать');
   await page.locator('#fExample').fill('Do not abandon your plans.'); await page.locator('#optionalCardFields summary').click(); await page.locator('#fExampleRu').fill('Не отказывайся от своих планов.');
   await page.getByRole('button',{name:'Сохранить карточку',exact:true}).click(); await idle();
   assert.equal((await state()).cards[0].word,'abandon');
  });
  await check('deck opens, reveals and completes without removed YouGlish node',async () => {
   await page.evaluate(() => openDeck('Oxford 3000'));
   assert.equal(await page.locator('#deckWord').textContent(),'abandon');
   await page.locator('#deckReveal').click(); await page.locator('#deckRates button').nth(1).click(); await idle();
   assert.equal(await page.evaluate(() => deckCurrent),null);
   assert.match(await page.locator('#deckEmpty').textContent(),/завершена/);
   assert.equal((await state()).cards[0].reps,1);
  });
  await check('edit persists and keeps learned schedule',async () => {
   const old = (await state()).cards[0];
   await page.evaluate(id => editCard(id),old.id);
   await page.locator('#fTranslation').fill('покидать, бросать');
   await page.getByRole('button',{name:'Сохранить карточку',exact:true}).click(); await idle();
   const updated = (await state()).cards[0];
   assert.equal(updated.translation,'покидать, бросать'); assert.equal(updated.reps,old.reps); assert.equal(updated.next,old.next);
   await page.reload(); await idle(); assert.equal((await state()).cards[0].translation,updated.translation);
  });
  await check('empty review then new due card and multiple review sessions',async () => {
   await page.evaluate(() => startReview()); assert.equal(await page.locator('#reviewCard').isVisible(),false);
   await page.evaluate(async () => { await mutateState(next => { next.cards[0].next=0; }); startReview(); });
   await page.locator('#revealBtn').click(); await page.locator('#rateBtns button').nth(0).click(); await idle();
   const failed = (await state()).cards[0]; assert.equal(failed.reps,0); assert.ok(failed.next > Date.now()+500000);
   await page.evaluate(() => startReview()); assert.equal(await page.locator('#reviewCard').isVisible(),false);
   await page.evaluate(async () => { await mutateState(next => { next.cards[0].next=0; }); startReview(); });
   assert.equal(await page.locator('#frontWord').textContent(),'abandon');
   await page.locator('#revealBtn').click(); await page.locator('#rateBtns button').nth(1).click(); await idle();
   assert.equal((await state()).cards[0].reps,1);
  });
  await check('empty custom decks survive restart',async () => {
   await page.evaluate(async () => mutateState(next => { next.decks.push('Empty custom deck'); }));
   const data = await page.evaluate(() => { const s={decks:['Only empty deck'],cards:[]}; const d=createDatabase(s); const result=readDatabase(d); d.close(); return result; });
   assert.deepEqual(data.decks,['Only empty deck']);
   await page.reload(); await idle(); assert.ok((await state()).decks.includes('Empty custom deck'));
  });
  await check('CSV BOM, quoted multiline fields, exampleRu and scheduling',async () => {
   await page.evaluate(() => show('settings'));
   await inputCSV('\ufeffword,translation,example,exampleRu,deck,reps,interval,ease,next\r\n"context","контекст","Line one\nLine ""two""","Перевод примера","CSV deck",3,7,2.8,123456789\r\n');
   const c = (await state()).cards.find(c => c.word==='context');
   assert.equal(c.exampleRu,'Перевод примера'); assert.equal(c.example,'Line one\nLine "two"'); assert.equal(c.reps,3);
  });
  await check('CSV repeated import skips duplicates; semicolon aliases',async () => {
   const csv='word;translation;example_ru;deck\nrepeat;повтор;Пример;CSV deck';
   await inputCSV(csv); const n=(await state()).cards.length; await inputCSV(csv); assert.equal((await state()).cards.length,n);
   await inputCSV('front\tback\nhello\tпривет'); assert.equal((await state()).cards.at(-1).word,'hello');
  });
  await check('bad CSV reports error without partial data',async () => {
   const before=await state(); await inputCSV('word,translation\n"broken,кавычки'); assert.deepEqual(await state(),before);
   await inputCSV('invalid,columns\na,b'); assert.deepEqual(await state(),before);
   await inputCSV('word,translation\n'+'x'.repeat(20001)+',слишком длинное поле'); assert.deepEqual(await state(),before);
  });
  await check('unsafe imported IDs and deck names render as text',async () => {
   await page.evaluate(async () => mutateState(next => {
    next.cards.push({id:"');window.injected=1;//",word:'<img src=x onerror="window.injected=1">',translation:'safe',deck:'A " & <tag>',example:'',exampleRu:'',ipa:'',reps:0,interval:0,ease:2.5,next:0});
   }));
   await page.evaluate(() => show('library')); assert.equal(await page.evaluate(() => window.injected),undefined);
   await page.locator('#cardList .listitem').last().getByRole('button',{name:/^Редактировать /}).click();
   assert.equal(await page.locator('#fWord').inputValue(),'<img src=x onerror="window.injected=1">');
   await page.evaluate(() => show('settings'));
  });
  await check('native TTS and external YouGlish receive correct strings',async () => {
   await page.evaluate(() => {
    window.calls=[]; window.AndroidBridge={speakText:(...a)=>calls.push(['speak',...a]),stopSpeech:()=>{},openExternalUrl:u=>calls.push(['url',u]),saveFile:(...a)=>calls.push(['file',...a])};
    openDeck('Oxford 3000'); playDictionaryAudio('uk'); playDictionaryAudio('us'); speakDeckExample(); openYouGlish();
   });
   const calls=await page.evaluate(() => calls);
   assert.deepEqual(calls[0],['speak','abandon','en-GB']); assert.deepEqual(calls[1],['speak','abandon','en-US']);
   assert.deepEqual(calls[2],['speak','Do not abandon your plans.','en-GB']);
   assert.match(calls[3][1],/^https:\/\/youglish\.com\/pronounce\/abandon\/english\/uk$/);
   await page.screenshot({path:path.join(output,'deck-phone.png'),fullPage:true,animations:'disabled'});
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  });
  let backup;
  await check('SQLite/CSV exports through Android bridge',async () => {
   await page.evaluate(() => exportSQLite()); await idle();
   const file=await page.evaluate(() => calls.filter(c=>c[0]==='file').at(-1)); backup=Buffer.from(file[3],'base64');
   assert.equal(backup.subarray(0,16).toString(),'SQLite format 3\0');
   await page.evaluate(() => exportCSV()); await idle();
   const csv=await page.evaluate(() => calls.filter(c=>c[0]==='file').at(-1));
   const roundtrip=await page.evaluate(content => csvCards(content).cards,Buffer.from(csv[3],'base64').toString());
   assert.equal(roundtrip.find(c=>c.word==='context').exampleRu,'Перевод примера');
   assert.equal(roundtrip.length,(await state()).cards.length);
  });
  await check('corrupt SQLite and wrong schema preserve active library',async () => {
   await page.evaluate(() => show('settings')); const before=await state();
   await inputSQLite(Buffer.from('broken sqlite file')); assert.deepEqual(await state(),before);
   const invalid=await page.evaluate(() => { const d=new SQL.Database();d.run('CREATE TABLE cards (id TEXT)');const b=Array.from(d.export());d.close();return b; });
   await inputSQLite(invalid); assert.deepEqual(await state(),before);
  });
  await check('SQLite import cancel, replace and durable recovery',async () => {
   await page.evaluate(async () => mutateState(next => { next.cards=next.cards.filter(c=>c.word!=='context'); }));
   const before=await state(); confirmation=false; await inputSQLite(backup); assert.deepEqual(await state(),before);
   confirmation=true; await inputSQLite(backup); assert.ok((await state()).cards.some(c=>c.word==='context'));
   await page.reload();await idle();assert.ok((await state()).cards.some(c=>c.word==='context'));
  });
  await check('disk write failure leaves state and durable database intact',async () => {
   const before=await state();
   await page.evaluate(async () => {
    window.realIdbPut=idbPut; idbPut=async()=>{throw new Error('simulated disk full');};
    await perform(()=>mutateState(next=>{next.cards=[];})); idbPut=window.realIdbPut;
   });
   assert.deepEqual(await state(),before);await page.reload();await idle();assert.deepEqual(await state(),before);
  });
  await check('folder import handles errors and duplicate files',async () => {
   await page.evaluate(async () => {
    await importCsvFilesFromNative([{name:'Folder.csv',content:'word,translation,exampleRu\nfolder,папка,Пример папки'},{name:'Broken.csv',content:'bad,header\nx,y'}]);
   }); await idle();
   assert.equal((await state()).cards.find(c=>c.word==='folder').exampleRu,'Пример папки');
   assert.match(await page.locator('#folderStatus').textContent(),/Ошибок: 1/);
  });
  await check('Android back goes home, then permits exit',async () => {
   assert.equal(await page.evaluate(()=>{show('settings');return handleAndroidBack();}),true);
   assert.equal(await page.evaluate(()=>handleAndroidBack()),false);
  });

  // Model Android's durable inbox in a separate storage key, including restarts.
  await context.addInitScript(() => {
   window.AndroidBridge = {
    stopSpeech:()=>{},
    peekSharedText:()=>JSON.stringify(JSON.parse(localStorage.getItem('test-share-inbox') || '[]')[0] || null),
    acknowledgeSharedText:id=>{
     if (localStorage.getItem('test-share-ack-fails')==='1') return false;
     const queue=JSON.parse(localStorage.getItem('test-share-inbox') || '[]');
     if (!queue.length || queue[0].id!==id) return false;
     queue.shift();localStorage.setItem('test-share-inbox',JSON.stringify(queue));return true;
    }
   };
  });
  let sharedBefore;
  async function sendShared(id,text) {
   await page.evaluate(({id,text})=>{
    const inbox=JSON.parse(localStorage.getItem('test-share-inbox') || '[]');inbox.push({id,text});
    localStorage.setItem('test-share-inbox',JSON.stringify(inbox));receiveSharedTextFromNative();
   },{id,text});
   await page.locator('#sharedTextDialog').waitFor({state:'visible'});
  }
  await check('cold Android share opens choice and writes only the word field',async()=>{
   sharedBefore=(await state()).cards.length;
   await page.evaluate(()=>{resetForm();localStorage.setItem('test-share-inbox',JSON.stringify([{id:'cold-word',text:'capture'}]));});
   await page.reload();await idle();await page.locator('#sharedTextDialog').waitFor({state:'visible'});
   assert.equal(await page.locator('#sharedTextPreview').textContent(),'capture');
   await page.locator('#shareToWord').click();
   assert.equal(await page.locator('#fWord').inputValue(),'capture');
   assert.equal(await page.locator('#fExample').inputValue(),'');
   assert.equal((await state()).cards.length,sharedBefore);
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('test-share-inbox')).length),0);
  });
  await check('warm share fills example in same draft preserving word translation and deck',async()=>{
   await page.locator('#fTranslation').fill('захватывать');await page.locator('#optionalCardFields summary').click();await page.locator('#fIpa').fill('/ˈkæptʃə/');
   await page.locator('#fDeck').selectOption('My words');
   await sendShared('warm-example','This sentence gives the word its context.');
   await page.locator('#shareToExample').click();
   assert.equal(await page.locator('#fWord').inputValue(),'capture');
   assert.equal(await page.locator('#fTranslation').inputValue(),'захватывать');
   assert.equal(await page.locator('#fExample').inputValue(),'This sentence gives the word its context.');
   assert.equal(await page.locator('#fDeck').inputValue(),'My words');
   assert.equal((await state()).cards.length,sharedBefore);
  });
  await check('draft survives full reload and is reachable from home',async()=>{
   await page.reload();await idle();
   assert.equal(await page.locator('#sharedTextDialog').isVisible(),false);
   await page.locator('#resumeDraftPanel button').click();
   assert.equal(await page.locator('#fWord').inputValue(),'capture');
   assert.equal(await page.locator('#fTranslation').inputValue(),'захватывать');
   assert.equal(await page.locator('#fExample').inputValue(),'This sentence gives the word its context.');
   assert.equal(await page.locator('#fDeck').inputValue(),'My words');
  });
  await check('replacement refusal and share cancellation preserve draft',async()=>{
   await sendShared('declined-word','replacement');confirmation=false;
   await page.locator('#shareToWord').click();confirmation=true;
   assert.equal(await page.locator('#sharedTextDialog').isVisible(),true);
   assert.equal(await page.locator('#fWord').inputValue(),'capture');
   await page.locator('#sharedTextDialog').getByRole('button',{name:'Отмена',exact:true}).click();
   assert.equal(await page.locator('#fWord').inputValue(),'capture');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('test-share-inbox')).length),0);
  });
  await check('shared markup and multiline examples remain literal text',async()=>{
   const value='<img src=x onerror="window.shareInjected=1">\nHe said "hello" & smiled.';
   await sendShared('literal-example',value);
   assert.equal(await page.locator('#sharedTextPreview img').count(),0);
   await page.screenshot({path:path.join(output,'share-choice-phone.png'),fullPage:true,animations:'disabled'});
   await page.locator('#shareToExample').click();
   assert.equal(await page.locator('#fExample').inputValue(),value);
   assert.equal(await page.evaluate(()=>window.shareInjected),undefined);
  });
  await check('failed draft write does not acknowledge or change the form',async()=>{
   const old=await page.locator('#fExample').inputValue();
   await sendShared('storage-retry','A safely retried example.');
   await page.evaluate(()=>{
    window.realCaptureSet=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key===CAPTURE_KEY)throw new Error('simulated draft quota');return window.realCaptureSet.call(this,key,value);};
   });
   await page.locator('#shareToExample').click();
   assert.match(await page.locator('#sharedTextError').textContent(),/simulated draft quota/);
   assert.equal(await page.locator('#fExample').inputValue(),old);
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('test-share-inbox')).length),1);
   await page.evaluate(()=>{Storage.prototype.setItem=window.realCaptureSet;});
   await page.locator('#shareToExample').click();
   assert.equal(await page.locator('#fExample').inputValue(),'A safely retried example.');
  });
  await check('duplicate native delivery after restart cannot overwrite a newer draft',async()=>{
   await page.evaluate(()=>localStorage.setItem('test-share-ack-fails','1'));
   await sendShared('ack-retry','Original received example.');await page.locator('#shareToExample').click();
   await page.locator('#fExample').fill('Manually improved example.');
   await page.reload();await idle();
   assert.equal(await page.locator('#sharedTextDialog').isVisible(),false);
   await page.locator('#resumeDraftPanel button').click();
   assert.equal(await page.locator('#fExample').inputValue(),'Manually improved example.');
   await page.evaluate(()=>{localStorage.removeItem('test-share-ack-fails');receiveSharedTextFromNative();});
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-share-inbox')).length===0);
  });
  await check('multiple pending shares stay ordered across chooser transitions',async()=>{
   await page.evaluate(()=>{
    localStorage.setItem('test-share-inbox',JSON.stringify([{id:'queued-word',text:'collect'},{id:'queued-example',text:'Collect words while you read.'}]));
    receiveSharedTextFromNative();
   });
   await page.locator('#shareToWord').click();
   await page.waitForFunction(()=>document.getElementById('sharedTextPreview').textContent==='Collect words while you read.');
   await page.locator('#shareToExample').click();
   assert.equal(await page.locator('#fWord').inputValue(),'collect');
   assert.equal(await page.locator('#fExample').inputValue(),'Collect words while you read.');
  });
  await check('shared draft becomes a card only on explicit save and clears the draft',async()=>{
   await page.getByRole('button',{name:'Сохранить карточку',exact:true}).click();await idle();
   const c=(await state()).cards.find(c=>c.word==='collect');
   assert.equal(c.example,'Collect words while you read.');assert.equal(c.translation,'захватывать');
   assert.equal((await state()).cards.length,sharedBefore+1);
   assert.equal(await page.evaluate(()=>captureEnvelope().draft),null);
  });
  await check('share into an edited card keeps its review schedule',async()=>{
   const c=(await state()).cards.find(c=>c.word==='abandon');
   await page.evaluate(id=>editCard(id),c.id);
   await sendShared('existing-example','A new example for an existing card.');await page.locator('#shareToExample').click();
   await page.evaluate(id=>{show('library');editCard(id);},c.id);
   assert.equal(await page.locator('#fExample').inputValue(),'A new example for an existing card.');
   await page.getByRole('button',{name:'Сохранить карточку',exact:true}).click();await idle();
   const updated=(await state()).cards.find(x=>x.id===c.id);
   assert.equal(updated.example,'A new example for an existing card.');assert.equal(updated.reps,c.reps);assert.equal(updated.next,c.next);
  });


  let english,unit,grandchild,travel,otherUnit;
  async function createDeckUI(name,parent=null) {
   await page.evaluate(parent=>{show('decks');newDeck(parent);},parent);
   await page.locator('#deckEditorName').fill(name);
   await page.locator('#deckEditor').getByRole('button',{name:'Сохранить',exact:true}).click();await idle();
   assert.equal(await page.locator('#deckEditor').isVisible(),false);
   return page.evaluate(({name,parent})=>db.decks.find(d=>db.deckMeta[d].name===name&&db.deckMeta[d].parent===parent),{name,parent});
  }
  await check('legacy SQLite migrates deck names and schedules without invented history',async()=>{
   const old=await page.evaluate(()=>{
    const d=new SQL.Database();d.run('CREATE TABLE decks(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE)');
    d.run("CREATE TABLE cards(id TEXT PRIMARY KEY,deck_name TEXT,word TEXT,translation TEXT,ipa TEXT,example TEXT,example_ru TEXT,reps INTEGER,interval_days REAL,ease REAL,next_review INTEGER)");
    d.run("INSERT INTO decks(name) VALUES('Original / literal name')");
    d.run("INSERT INTO cards VALUES('legacy','Original / literal name','legacy','наследие','','','',2,3,2.5,12345)");
    const migrated=readDatabase(d);d.close();const next=createDatabase(migrated);const restored=readDatabase(next);next.close();return restored;
   });
   assert.deepEqual(old.reviews,[]);assert.equal(old.deckMeta['Original / literal name'].parent,null);
   assert.equal(old.cards[0].reps,2);assert.equal(old.cards[0].next,12345);
  });
  await check('create nested decks and allow the same child label under different parents',async()=>{
   english=await createDeckUI('English');unit=await createDeckUI('Unit 1',english);grandchild=await createDeckUI('Examples',unit);
   travel=await createDeckUI('Travel');otherUnit=await createDeckUI('Unit 1',travel);assert.notEqual(unit,otherUnit);
   await page.evaluate(async ({english,unit,grandchild,travel})=>mutateState(next=>{
    for(const [deck,word] of [[english,'root-word'],[unit,'unit-word'],[grandchild,'nested-word'],[travel,'travel-word']])next.cards.push({id:uid(),deck,word,translation:'перевод',ipa:'',example:'',exampleRu:'',reps:0,interval:0,ease:2.5,next:0});
   }),{english,unit,grandchild,travel});
   assert.equal(await page.evaluate(key=>deckPath(key),grandchild),'English / Unit 1 / Examples');
  });
  await check('parent training and library filters include all descendants exactly once',async()=>{
   await page.evaluate(key=>openDeck(key),english);assert.equal(await page.evaluate(()=>deckQueue.length),3);
   await page.evaluate(key=>openDeck(key),unit);assert.equal(await page.evaluate(()=>deckQueue.length),2);
   await page.evaluate(()=>show('library'));await page.locator('#libraryDeckFilter').selectOption(english);
   assert.equal(await page.locator('#cardList .listitem').count(),3);
   await page.locator('#libraryDeckFilter').selectOption('');
  });
  await check('deck rename keeps stable card assignments; sibling collisions are rejected',async()=>{
   await page.evaluate(key=>renameDeck(key),english);await page.locator('#deckEditorName').fill('English reading');
   await page.locator('#deckEditor').getByRole('button',{name:'Сохранить',exact:true}).click();await idle();
   assert.equal(await page.evaluate(key=>deckPath(key),grandchild),'English reading / Unit 1 / Examples');
   await page.evaluate(key=>renameDeck(key),unit);await page.locator('#deckEditorParent').selectOption(travel);
   await page.locator('#deckEditor').getByRole('button',{name:'Сохранить',exact:true}).click();await idle();
   assert.equal((await state()).deckMeta[unit].parent,english);
   assert.equal(await page.locator('#deckEditor').isVisible(),true);
   await page.locator('#deckEditorName').fill('Reading');
   await page.locator('#deckEditor').getByRole('button',{name:'Сохранить',exact:true}).click();await idle();
   assert.equal(await page.evaluate(key=>deckPath(key),grandchild),'Travel / Reading / Examples');
   assert.equal((await state()).cards.find(c=>c.word==='unit-word').deck,unit);
  });
  await check('cyclic parent updates fail without changing cards history or hierarchy',async()=>{
   const before=await state();
   await page.evaluate(async ({travel,grandchild})=>perform(()=>mutateState(next=>{next.deckMeta[travel].parent=grandchild;})),{travel,grandchild});
   assert.deepEqual(await state(),before);
   await page.reload();await idle();assert.deepEqual(await state(),before);
  });
  await check('real training persists review events atomically with scheduling',async()=>{
   const n=(await state()).reviews.length;
   await page.evaluate(key=>openDeck(key),unit);
   await page.locator('#deckReveal').click();await page.locator('#deckRates button').nth(0).click();await idle();
   await page.locator('#deckReveal').click();await page.locator('#deckRates button').nth(1).click();await idle();
   const history=(await state()).reviews;assert.equal(history.length,n+2);
   assert.deepEqual(history.slice(-2).map(r=>r.known),[false,true]);
   assert.equal(history.at(-2).deck,unit);assert.equal(history.at(-1).deck,grandchild);
   await page.reload();await idle();assert.equal((await state()).reviews.length,n+2);
  });
  await check('review write failure and double tap cannot inflate statistics',async()=>{
   await page.evaluate(key=>{openDeck(key);revealDeckWord();},unit);
   const n=(await state()).reviews.length;
   await page.evaluate(async()=>{const original=idbPut;idbPut=async()=>{throw new Error('simulated review write failure');};try{await rateDeckWord(true);}finally{idbPut=original;}});
   assert.equal((await state()).reviews.length,n);
   await page.evaluate(async()=>{await Promise.all([rateDeckWord(true),rateDeckWord(true)]);});
   assert.equal((await state()).reviews.length,n+1);
  });
  await check('statistics uses local calendar days across DST and excludes future events',async()=>{
   const result=await page.evaluate(()=>{
    const now=new Date(2026,9,26,12).getTime();
    const history=[{id:'a',at:new Date(2026,9,24,12).getTime(),known:true},{id:'b',at:new Date(2026,9,25,12).getTime(),known:false},{id:'c',at:new Date(2026,9,26,10).getTime(),known:true},{id:'d',at:new Date(2026,9,26,11).getTime(),known:false},{id:'future',at:new Date(2026,9,27,12).getTime(),known:true}].map(r=>({...r,cardId:'fixture',deck:'D',interval:0}));
    const fixture=normalizeState({decks:['D'],cards:[],reviews:history});
    const stats=statisticsSnapshot(fixture,'','7',now);
    return {count:stats.reviews.length,rate:stats.rate,streak:stats.streak,keys:stats.buckets.map(b=>b.key),durations:stats.buckets.slice(1).map((b,i)=>b.at-stats.buckets[i].at),empty:statisticsSnapshot({...fixture,reviews:[]},'','7',now).rate,yesterday:reviewStreak(history.filter(r=>r.id==='a'||r.id==='b'),now)};
   });
   assert.equal(result.count,4);assert.equal(result.rate,50);assert.equal(result.streak,3);assert.equal(result.yesterday,2);assert.equal(result.empty,null);
   assert.equal(new Set(result.keys).size,7);assert.ok(result.durations.includes(25*3600000));
  });
  await check('statistics filters and daily chart render correctly on a phone',async()=>{
   await page.evaluate(()=>show('stats'));await page.locator('#statsDeck').selectOption(travel);
   for(const period of ['7','30','all']){
    await page.locator('#statsPeriod').selectOption(period);
    const snapshot=await page.evaluate(()=>statisticsSnapshot(db,document.getElementById('statsDeck').value,document.getElementById('statsPeriod').value));
    assert.equal(Number(await page.locator('#statsAttempts').textContent()),snapshot.reviews.length);
    assert.equal(await page.locator('#statsRate').textContent(),snapshot.rate===null?'—':snapshot.rate+'%');
    assert.equal(await page.locator('#statsChart button').count(),period==='7'?7:30);
   }
   await page.locator('#statsChart button').last().click();assert.match(await page.locator('#statsChartDetail').textContent(),/повторений/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:path.join(output,'statistics-phone.png'),fullPage:true,animations:'disabled'});
   await page.evaluate(()=>show('decks'));await page.screenshot({path:path.join(output,'subdecks-phone.png'),fullPage:true,animations:'disabled'});
  });
  let hierarchyBackup,hierarchyCsv,hierarchyState;
  await check('SQLite backup contains subdecks and complete review history',async()=>{
   await page.evaluate(()=>{window.exports=[];AndroidBridge.saveFile=(...args)=>window.exports.push(args);});
   hierarchyState=await state();await page.evaluate(()=>exportSQLite());await idle();
   hierarchyBackup=Buffer.from((await page.evaluate(()=>window.exports.at(-1)))[2],'base64');
   const restored=await page.evaluate(bytes=>{const d=new SQL.Database(new Uint8Array(bytes));const state=readDatabase(d);d.close();return clone(state);},Array.from(hierarchyBackup));
   assert.deepEqual(restored,hierarchyState);
  });
  await check('CSV transfers hierarchy and deduplicates cards across reimport',async()=>{
   await page.evaluate(()=>exportCSV());await idle();
   hierarchyCsv=Buffer.from((await page.evaluate(()=>window.exports.at(-1)))[2],'base64').toString();
   await page.evaluate(()=>resetAllData());await idle();assert.equal((await state()).reviews.length,0);
   await inputCSV(hierarchyCsv);const n=(await state()).cards.length;await inputCSV(hierarchyCsv);assert.equal((await state()).cards.length,n);
   const path=await page.evaluate(()=>deckPath(db.cards.find(c=>c.word==='nested-word').deck));assert.equal(path,'Travel / Reading / Examples');
   await inputSQLite(hierarchyBackup);assert.deepEqual(await state(),hierarchyState);
  });
  await check('invalid hierarchy in imported SQLite preserves current library and history',async()=>{
   const bytes=await page.evaluate(key=>{const d=createDatabase(db);d.run('UPDATE decks SET parent_key=? WHERE name=?',[key,key]);const bytes=Array.from(d.export());d.close();return bytes;},travel);
   await inputSQLite(bytes);assert.deepEqual(await state(),hierarchyState);
  });


  await check('all sections open from home and return home on 320 and 390 pixel phones',async()=>{
   for(const width of [320,390]){
    await page.setViewportSize({width,height:844});await page.evaluate(()=>show('home'));
    assert.equal(await page.locator('#bottomNav').count(),0);
    assert.equal(await page.locator('#backHome').isVisible(),false);
    for(const [id,link] of [['library','homeCardsLink'],['decks','homeDecksLink'],['stats','homeStatsLink'],['settings','homeDataLink']]){
     assert.equal(await page.locator('#'+link).count(),1);
     await page.locator('#'+link).click();assert.equal(await page.evaluate(()=>activePage),id);
     const back=page.getByRole('button',{name:'На главную',exact:true});await back.click();
     assert.equal(await page.evaluate(()=>activePage),'home');
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }
  });
  await check('form validation focuses the missing field without losing entered text',async()=>{
   await page.evaluate(()=>{show('library');resetForm();openNewCard();});
   await page.getByRole('button',{name:'Сохранить карточку',exact:true}).click();
   assert.equal(await page.evaluate(()=>document.activeElement.id),'fWord');assert.equal(await page.locator('#fWord').getAttribute('aria-invalid'),'true');
   await page.locator('#fWord').fill('ui-safe');await page.getByRole('button',{name:'Сохранить карточку',exact:true}).click();
   assert.equal(await page.evaluate(()=>document.activeElement.id),'fTranslation');assert.equal(await page.locator('#fWord').inputValue(),'ui-safe');
   await page.locator('#fTranslation').fill('проверка интерфейса');await page.getByRole('button',{name:'Сохранить карточку',exact:true}).click();await idle();
   assert.match(await page.locator('#toast').textContent(),/добавлена/);
  });
  await check('leaving and reopening editor preserves draft; discarding requires confirmation',async()=>{
   await page.evaluate(()=>openNewCard());await page.locator('#fWord').fill('draft navigation');
   await page.getByRole('button',{name:'Сохранить черновик и вернуться',exact:true}).click();
   assert.equal(await page.evaluate(()=>activePage),'library');await page.evaluate(()=>openNewCard());
   assert.equal(await page.locator('#fWord').inputValue(),'draft navigation');
   confirmation=false;await page.getByRole('button',{name:'Удалить черновик',exact:true}).click();confirmation=true;
   assert.equal(await page.locator('#fWord').inputValue(),'draft navigation');
   await page.getByRole('button',{name:'Удалить черновик',exact:true}).click();assert.equal(await page.evaluate(()=>captureEnvelope().draft),null);
  });
  await check('card action menu edits and deletes the chosen card safely',async()=>{
   await page.evaluate(()=>{show('library');setLibraryStatus('all');});
   await page.getByRole('button',{name:'Действия с карточкой ui-safe',exact:true}).click();
   await page.locator('#cardActions').getByRole('button',{name:'Редактировать карточку',exact:true}).click();
   assert.equal(await page.locator('#fWord').inputValue(),'ui-safe');await page.getByRole('button',{name:'Сохранить черновик и вернуться',exact:true}).click();
   await page.getByRole('button',{name:'Действия с карточкой ui-safe',exact:true}).click();confirmation=false;
   await page.locator('#cardActions').getByRole('button',{name:'Удалить карточку',exact:true}).click();confirmation=true;
   assert.ok((await state()).cards.some(c=>c.word==='ui-safe'));
   await page.getByRole('button',{name:'Действия с карточкой ui-safe',exact:true}).click();
   await page.locator('#cardActions').getByRole('button',{name:'Удалить карточку',exact:true}).click();await idle();
   assert.equal((await state()).cards.some(c=>c.word==='ui-safe'),false);await page.evaluate(()=>resetForm());
  });
  await check('library status chips and clear search return the expected cards',async()=>{
   await page.evaluate(()=>{show('library');document.getElementById('libraryDeckFilter').value='';setLibraryStatus('known');});
   assert.equal(await page.locator('#cardList .library-card').count(),(await state()).cards.filter(c=>c.reps>=2).length);
   await page.locator('#search').fill('no-results-ui-123');assert.equal(await page.locator('#cardList .library-card').count(),0);
   await page.getByRole('button',{name:'Очистить поиск',exact:true}).click();assert.equal(await page.locator('#search').inputValue(),'');
   await page.evaluate(()=>setLibraryStatus('all'));
  });
  await check('collapsing subdecks is retained across reload without changing cards',async()=>{
   const before=(await state()).cards.length;await page.evaluate(()=>show('decks'));
   await page.locator('[data-deck-key="'+travel+'"] .deck-toggle').click();
   assert.equal(await page.locator('[data-deck-key="'+unit+'"]').count(),0);
   await page.reload();await idle();await page.evaluate(()=>show('decks'));
   assert.equal(await page.locator('[data-deck-key="'+unit+'"]').count(),0);
   await page.locator('[data-deck-key="'+travel+'"] .deck-toggle').click();
   assert.equal(await page.locator('[data-deck-key="'+unit+'"]').count(),1);assert.equal((await state()).cards.length,before);
  });
  await check('focus training keeps answer controls reachable on a small phone',async()=>{
   await page.setViewportSize({width:320,height:740});await page.evaluate(key=>{show('decks');openDeck(key);},unit);
   assert.equal(await page.locator('#bottomNav').isVisible(),false);assert.equal(await page.locator('#appHeader').isVisible(),false);
   await page.locator('#deckReveal').click();await page.locator('#deckRates').scrollIntoViewIfNeeded();
   const box=await page.locator('#deckRates').boundingBox();assert.ok(box.y>=0 && box.y+box.height<=741);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.getByRole('button',{name:'Назад к колодам',exact:true}).click();assert.equal(await page.evaluate(()=>activePage),'decks');
   await page.setViewportSize({width:390,height:844});
  });
  await check('hardware back closes action dialogs before changing the page',async()=>{
   await page.evaluate(key=>{show('decks');openDeckActions(key);},travel);
   assert.equal(await page.evaluate(()=>handleAndroidBack()),true);assert.equal(await page.locator('#deckActions').isVisible(),false);assert.equal(await page.evaluate(()=>activePage),'decks');
  });
  // Reproducible sample data for the UI screenshots; never shipped as user data.
  await page.evaluate(async()=>{
   const demo={decks:['Everyday English','Книги','Путешествия'],cards:[],reviews:[],deckMeta:{'Everyday English':{name:'Everyday English',parent:null},'Книги':{name:'Книги',parent:null},'Путешествия':{name:'Путешествия',parent:null}}};
   const child=ensureDeckPath(demo,['Книги','Atomic Habits']);
   const words=[['make a difference','менять что-то к лучшему'],['take for granted','принимать как должное'],['curious','любознательный'],['thoughtful','внимательный, вдумчивый'],['reliable','надёжный'],['beyond','за пределами'],['look forward to','с нетерпением ждать'],['at ease','непринуждённо']];
   for(let i=0;i<24;i++){const w=words[i%words.length];demo.cards.push({id:'demo-'+i,word:w[0],translation:w[1],deck:i<12?'Everyday English':i<20?child:'Путешествия',ipa:i===0?'/meɪk ə ˈdɪfrəns/':'',example:i===0?'One small action can make a difference.':'',exampleRu:i===0?'Один маленький поступок может что-то изменить.':'',reps:i<7?0:i<12?1:2,interval:i<7?0:3,ease:2.5,next:i<7?0:Date.now()+86400000});}
   for(let d=0;d<7;d++)for(let i=0;i<[8,12,5,17,11,15,9][d];i++)demo.reviews.push({id:'demo-review-'+d+'-'+i,cardId:'demo-'+i%24,deck:demo.cards[i%24].deck,at:localDayOffset(Date.now(),d-6).getTime()+10*3600000,known:i%4!==0,interval:3});
   await commitState(demo);renderAll();resetForm();setLibraryStatus('all');show('home');
  });
  await page.screenshot({path:path.join(output,'ui-home-0.6.1.png'),fullPage:true,animations:'disabled'});
  await page.evaluate(()=>show('library'));await page.screenshot({path:path.join(output,'ui-library-0.6.1.png'),fullPage:true,animations:'disabled'});
  await page.evaluate(()=>show('decks'));await page.screenshot({path:path.join(output,'ui-decks-0.6.1.png'),fullPage:true,animations:'disabled'});
  await page.evaluate(()=>{show('home');startReview();reveal();});await page.screenshot({path:path.join(output,'ui-review-0.6.1.png'),fullPage:true,animations:'disabled'});
  await page.evaluate(()=>{show('stats');document.getElementById('statsDeck').value='';document.getElementById('statsPeriod').value='7';renderStatistics();});await page.screenshot({path:path.join(output,'ui-stats-0.6.1.png'),fullPage:true,animations:'disabled'});

  await page.screenshot({path:path.join(output,'home-phone.png'),fullPage:true,animations:'disabled'});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(output,'regression.json'),JSON.stringify({passed,uncaughtErrors:pageErrors,externalRequests:external,alerts},null,2));
  console.log('All '+passed.length+' regression checks passed.');
 } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
