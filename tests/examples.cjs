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
 const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,hasTouch:true,isMobile:true,timezoneId:'Europe/Berlin'});
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
 async function skipExample(){await page.locator('#exampleComposerSkip').click();await page.waitForFunction(()=>exampleComposer===null);}
 async function inputCSV(csv) {
  await page.locator('#csvFile').setInputFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from(csv)}); await idle();
 }
 async function inputSQLite(bytes) {
  await page.locator('#sqliteFile').setInputFiles({name:'test.sqlite',mimeType:'application/octet-stream',buffer:Buffer.from(bytes)}); await idle();
 }
 async function seed(cards) {
  await page.evaluate(async cards=>{await commitState({decks:['Examples'],cards,reviews:[]});resetForm();renderAll();show('home');},cards);
 }
 const card=(id,examples=[])=>({id,word:id,translation:'перевод '+id,deck:'Examples',ipa:'',reps:0,interval:0,ease:2.5,next:0,examples});
 async function closeComposer(){await page.locator('#exampleComposerSkip').click();await page.waitForFunction(()=>exampleComposer===null);}
 async function gesture(scope,vertical=false) {
  const panel=page.locator('#'+scope+'Examples');await panel.scrollIntoViewIfNeeded();const box=await panel.boundingBox();
  const x1=box.x+box.width*.8,x2=box.x+box.width*.2,y=box.y+55;
  const session=await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y}]});
  for(let i=1;i<=5;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:vertical?x1:x1+(x2-x1)*i/5,y:vertical?y+50*i/5:y}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
 }
 try {
  await page.goto(url+'/');await idle();
  await check('single-example SQLite migration preserves text, notes and review dates',async()=>{
   const migrated=await page.evaluate(()=>{
    const d=new SQL.Database();d.run('CREATE TABLE decks(id INTEGER PRIMARY KEY,name TEXT)');d.run("INSERT INTO decks VALUES(1,'Legacy')");
    d.run('CREATE TABLE cards(id TEXT,deck_name TEXT,word TEXT,translation TEXT,ipa TEXT,example TEXT,example_ru TEXT,reps INTEGER,interval_days REAL,ease REAL,next_review INTEGER)');
    d.run('INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?,?)',['legacy','Legacy','legacy','старое','','He said "hello".\nA second line.','Перевод',3,8,2.8,123456789]);
    const state=readDatabase(d);d.close();const roundtrip=createDatabase(state);const result=readDatabase(roundtrip);roundtrip.close();return result;
   });
   assert.equal(migrated.cards[0].examples.length,1);assert.equal(migrated.cards[0].examples[0].text,'He said "hello".\nA second line.');assert.equal(migrated.cards[0].examples[0].translation,'Перевод');assert.equal(migrated.cards[0].next,123456789);assert.deepEqual(migrated.reviews,[]);
  });
  await check('editor adds several examples and translations, keeps them through reload',async()=>{
   await seed([]);await page.evaluate(()=>openNewCard());
   await page.locator('#fWord').fill('curious');await page.locator('#fTranslation').fill('любопытный');await page.locator('#fExample').fill('I am curious about this book.');
   for(const phrase of ['My cat is curious.','Stay curious.']){await page.locator('#addEditorExample').click();await page.locator('#additionalExamples [data-example-text]').last().fill(phrase);}
   await page.locator('#additionalExamples [data-example-translation]').last().fill('Оставайся любопытным.');
   await page.getByRole('button',{name:'Сохранить карточку',exact:true}).click();await idle();
   const saved=await state();assert.equal(saved.cards[0].examples.length,3);assert.equal(saved.cards[0].examples[2].translation,'Оставайся любопытным.');
   await page.reload();await idle();assert.deepEqual(await state(),saved);
  });
  await check('touch swipe, arrows and keyboard change examples without grading the card',async()=>{
   await page.evaluate(()=>{startReview();reveal();});const before=await state();
   assert.equal(await page.locator('#reviewExampleCounter').textContent(),'1 / 3');
   await gesture('review');assert.equal(await page.locator('#reviewExampleCounter').textContent(),'2 / 3');assert.equal(await page.locator('#backExample').textContent(),'My cat is curious.');
   await page.locator('#reviewExampleNext').click();assert.equal(await page.locator('#backNote').textContent(),'Оставайся любопытным.');
   await page.locator('#reviewExamples').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#reviewExampleCounter').textContent(),'2 / 3');
   await gesture('review',true);assert.equal(await page.locator('#reviewExampleCounter').textContent(),'2 / 3');assert.deepEqual(await state(),before);
   await page.evaluate(()=>{window.spoken=[];window.AndroidBridge={stopSpeech:()=>{},speakText:(...args)=>spoken.push(args)};});
   await page.locator('#reviewSpeakExample').click();assert.deepEqual(await page.evaluate(()=>spoken.at(-1)),['My cat is curious.','en-US']);
  });
  await check('Again offers a phrase, records the grade once and adds without rescheduling',async()=>{
   const before=(await state()).cards[0];await page.locator('#rateBtns button').first().click();await idle();
   assert.equal(await page.locator('#exampleComposer').isVisible(),true);const graded=await state();assert.equal(graded.reviews.length,1);assert.ok(graded.cards[0].next>Date.now()+500000);
   await page.locator('#newExampleText').fill('I was curious enough to ask.');await page.locator('#newExampleTranslation').fill('Мне стало любопытно, и я спросил.');
   await page.locator('#saveStudyExample').click();await idle();await page.waitForFunction(()=>exampleComposer===null);
   const after=await state();assert.equal(after.cards[0].examples.length,before.examples.length+1);assert.equal(after.cards[0].next,graded.cards[0].next);assert.equal(after.cards[0].reps,graded.cards[0].reps);assert.equal(after.reviews.length,1);assert.equal(after.cards[0].example,before.example);assert.equal(await page.evaluate(()=>current),null);
  });
  await check('deck study swipes through all examples and speaks the selected UK phrase',async()=>{
   await page.evaluate(async()=>{await mutateState(next=>{next.cards[0].next=Date.now()-1;});openDeck('Examples');revealDeckWord();});
   assert.equal(await page.locator('#deckExampleCounter').textContent(),'1 / 4');await gesture('deck');assert.equal(await page.locator('#deckExampleCounter').textContent(),'2 / 4');
   await page.locator('#speakExampleBtn').click();assert.deepEqual(await page.evaluate(()=>spoken.at(-1)),['My cat is curious.','en-GB']);
   await page.locator('#deckAddExample').click();await page.locator('#newExampleText').fill('Another curious thought.');
   const before=await state();await page.locator('#saveStudyExample').click();await idle();await page.waitForFunction(()=>exampleComposer===null);
   assert.equal(await page.locator('#deckExampleCounter').textContent(),'5 / 5');assert.equal(await page.locator('#deckExample').textContent(),'Another curious thought.');assert.equal((await state()).cards[0].next,before.cards[0].next);assert.equal((await state()).reviews.length,before.reviews.length);
  });
  await check('failed phrase save keeps the text and retries exactly once',async()=>{
   await page.locator('#deckAddExample').click();await page.locator('#newExampleText').fill('Do not lose this phrase.');const before=await state();
   await page.evaluate(async()=>{const original=idbPut;idbPut=async()=>{throw new Error('example disk full');};try{await saveStudyExample();}finally{idbPut=original;}});
   assert.deepEqual(await state(),before);assert.equal(await page.locator('#newExampleText').inputValue(),'Do not lose this phrase.');assert.match(await page.locator('#exampleComposerError').textContent(),/example disk full/);
   await page.evaluate(async()=>{await Promise.all([saveStudyExample(),saveStudyExample()]);});await page.waitForFunction(()=>exampleComposer===null);
   assert.equal((await state()).cards[0].examples.length,before.cards[0].examples.length+1);assert.equal((await state()).reviews.length,before.reviews.length);
  });
  await check('unfinished phrase survives hardware back and restart and is reachable from home',async()=>{
   await page.locator('#deckRates button').first().click();await idle();await page.locator('#newExampleText').fill('A draft of my own phrase.');const graded=await state();
   await page.evaluate(()=>handleAndroidBack());await page.waitForFunction(()=>exampleComposer===null);assert.deepEqual(await state(),graded);
   await page.reload();await idle();await page.locator('#resumeExampleButton').click();assert.equal(await page.locator('#newExampleText').inputValue(),'A draft of my own phrase.');
   await page.locator('#saveStudyExample').click();await idle();await page.waitForFunction(()=>exampleComposer===null);assert.equal((await state()).cards[0].next,graded.cards[0].next);assert.equal((await state()).reviews.length,graded.reviews.length);
  });
  await check('card editor draft retains extra examples and does not overwrite phrases added in study',async()=>{
   const c=(await state()).cards[0];await page.evaluate(id=>editCard(id),c.id);await page.locator('#fTranslation').fill('мой перевод');
   await page.locator('#addEditorExample').click();await page.locator('#additionalExamples [data-example-text]').last().fill('Unsaved editor phrase.');
   await page.reload();await idle();await page.locator('#resumeDraftPanel button').click();assert.equal(await page.locator('#additionalExamples [data-example-text]').last().inputValue(),'Unsaved editor phrase.');
   await page.evaluate(id=>{show('home');openExampleComposer(id);},c.id);await page.locator('#newExampleText').fill('Added while the card draft was open.');
   await page.locator('#saveStudyExample').click();await idle();await page.waitForFunction(()=>exampleComposer===null);
   await page.evaluate(()=>resumeCardDraft());await page.getByRole('button',{name:'Сохранить карточку',exact:true}).click();await idle();
   const after=(await state()).cards[0];assert.equal(after.translation,'мой перевод');assert.ok(after.examples.some(e=>e.text==='Unsaved editor phrase.'));assert.ok(after.examples.some(e=>e.text==='Added while the card draft was open.'));assert.equal(after.next,c.next);
  });
  await check('removing an editor example preserves the remaining order and identities',async()=>{
   const c=(await state()).cards[0];await page.evaluate(id=>editCard(id),c.id);await page.locator('#additionalExamples button').first().click();
   await page.getByRole('button',{name:'Сохранить карточку',exact:true}).click();await idle();assert.deepEqual((await state()).cards[0].examples,[c.examples[0],...c.examples.slice(2)]);
  });
  await check('hundreds of examples survive SQLite and quoted multiline CSV roundtrips',async()=>{
   await seed([card('many',Array.from({length:250},(_,i)=>({id:'phrase-'+i,text:'Example '+i+' says "hello".\nAnd continues.',translation:'Перевод '+i}))) ]);
   const saved=await state();const restored=await page.evaluate(()=>{const d=createDatabase(db);const result=readDatabase(d);d.close();return result;});assert.deepEqual(restored,saved);
   await page.evaluate(()=>{window.files=[];window.AndroidBridge={stopSpeech:()=>{},saveFile:(...args)=>files.push(args)};});await page.evaluate(()=>exportCSV());await idle();
   const content=await page.evaluate(()=>files.at(-1));const csv=Buffer.from(content[2],'base64').toString();
   const rows=await page.evaluate(csv=>csvCards(csv).cards,csv);assert.deepEqual(rows[0].examples,saved.cards[0].examples);
   await page.evaluate(async rows=>{await appendCards(rows);await appendCards(rows);},rows);assert.equal((await state()).cards.length,1);
  });
  await check('malformed example backups are rejected without changing the library',async()=>{
   const before=await state();const bytes=await page.evaluate(()=>{const d=createDatabase(db);d.run("UPDATE cards SET examples_json='broken JSON'");const bytes=Array.from(d.export());d.close();return bytes;});
   await page.evaluate(()=>show('settings'));await inputSQLite(bytes);assert.deepEqual(await state(),before);
   const invalid=await page.evaluate(()=>{try{normalizeState({...db,cards:[{...db.cards[0],examples:[{id:'dup',text:'one'},{id:'dup',text:'two'}]}]});return false;}catch{return true;}});assert.equal(invalid,true);
  });
  await check('empty and single-example cards behave correctly on a 320-pixel phone',async()=>{
   await seed([card('empty')]);await page.setViewportSize({width:320,height:740});await page.evaluate(()=>{startReview();reveal();});
   assert.equal(await page.locator('#reviewExampleCounter').textContent(),'Нет примеров');assert.equal(await page.locator('#reviewSpeakExample').isVisible(),false);assert.equal(await page.locator('#reviewExampleNext').isDisabled(),true);
   await page.locator('#reviewAddExample').click();await page.locator('#saveStudyExample').click();assert.match(await page.locator('#exampleComposerError').textContent(),/Напиши фразу/);
   await page.locator('#newExampleText').fill('<img src=x onerror="window.exampleInjected=1">');await page.locator('#saveStudyExample').click();await idle();await page.waitForFunction(()=>exampleComposer===null);
   assert.equal(await page.locator('#reviewExampleCounter').textContent(),'1 / 1');assert.equal(await page.locator('#reviewSwipeHint').isVisible(),false);assert.equal(await page.locator('#backExample img').count(),0);assert.equal(await page.evaluate(()=>window.exampleInjected),undefined);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:path.join(output,'examples-review-320.png'),fullPage:true,animations:'disabled'});
  });
  await check('retry after draft cleanup failure is idempotent',async()=>{
   await page.locator('#reviewAddExample').click();await page.locator('#newExampleText').fill('A stable save.');
   await page.evaluate(()=>{window.originalRemove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(key){if(key.startsWith(EXAMPLE_DRAFT_PREFIX))throw new Error('draft cleanup failed');return originalRemove.call(this,key);};});
   await page.locator('#saveStudyExample').click();await idle();await page.waitForFunction(()=>exampleComposer===null);const after=await state();
   await page.evaluate(()=>{Storage.prototype.removeItem=window.originalRemove;});await page.reload();await idle();assert.equal(await page.locator('#resumeExamplePanel').isVisible(),false);
   await page.evaluate(()=>openExampleComposer(db.cards[0].id));assert.equal(await page.locator('#newExampleText').inputValue(),'A stable save.');await page.locator('#saveStudyExample').click();await idle();await page.waitForFunction(()=>exampleComposer===null);assert.deepEqual(await state(),after);
  });
  await check('clearing the library also clears unfinished example drafts',async()=>{
   await page.evaluate(()=>openExampleComposer(db.cards[0].id));await page.locator('#newExampleText').fill('Unfinished before clear.');await closeComposer();
   await page.evaluate(()=>resetAllData());await idle();assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith(EXAMPLE_DRAFT_PREFIX))),false);assert.equal(await page.locator('#resumeExamplePanel').isVisible(),false);
  });
  await page.setViewportSize({width:390,height:844});await seed([card('curious',[{id:'one',text:'I am curious about the world.',translation:'Мне интересен мир.'},{id:'two',text:'My curious friend asked another question.',translation:'Мой любопытный друг задал ещё вопрос.'},{id:'three',text:'Stay curious, even when it is difficult.',translation:'Сохраняй любопытство, даже когда трудно.'}])]);
  await page.evaluate(()=>{startReview();reveal();});await page.screenshot({path:path.join(output,'examples-review-390.png'),fullPage:true,animations:'disabled'});
  await page.locator('#rateBtns button').first().click();await idle();await page.locator('#newExampleText').fill('I am curious to try this myself.');await page.screenshot({path:path.join(output,'examples-own-phrase-390.png'),fullPage:true,animations:'disabled'});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);fs.writeFileSync(path.join(output,'examples.json'),JSON.stringify({passed,pageErrors,external,alerts},null,2));console.log('All '+passed.length+' example checks passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
