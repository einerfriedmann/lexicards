const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const vm=require('node:vm');
const sandbox={Date,Intl,localStorage:{getItem:()=>null}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('app/src/main/assets/review.js','utf8')+'\nthis.api={isNewCard,isReviewDue,reviewStatus,reviewPlan,scheduledAnswer,dailyNewLimit};',sandbox);
const {isNewCard,isReviewDue,reviewStatus,reviewPlan,scheduledAnswer,dailyNewLimit}=sandbox.api;
const now=new Date(2026,10,11,14).getTime();
const fresh=(id='new',deck='A')=>({id,deck,reps:0,interval:0,next:0,ease:2.5});
const ids=p=>Array.from(p.cards,c=>c.id);
test('100 new words mean zero due and a stable daily plan of 20',()=>{
 const state={cards:Array.from({length:100},(_,i)=>fresh(String(i))),reviews:[]};
 const original=JSON.stringify(state),a=reviewPlan(state,{now}),b=reviewPlan(JSON.parse(original),{now});
 assert.equal(a.due.length,0);assert.equal(a.selectedNew.length,20);assert.deepEqual(ids(a),ids(b));assert.equal(JSON.stringify(state),original);
});
test('overdue cards come first, oldest deadline first; future cards excluded',()=>{
 const state={cards:[fresh(),{...fresh('future'),next:now+1},{...fresh('recent'),next:now-1},{...fresh('old'),reps:2,interval:3,next:now-86400000}],reviews:[]};
 assert.deepEqual(ids(reviewPlan(state,{now})),['old','recent','new']);
 assert.equal(reviewStatus(state.cards[1],now),'later');
});
test('Again becomes due exactly ten minutes later and is never new again',()=>{
 const c=scheduledAnswer(fresh(),false,now);
 assert.equal(c.next,now+600000);assert.equal(isNewCard(c),false);assert.equal(isReviewDue(c,now+599999),false);assert.equal(isReviewDue(c,now+600000),true);
});
test('Known schedules 1 day, then 3 days, then increasing intervals without mutating input',()=>{
 const c=fresh(),a=scheduledAnswer(c,true,now),b=scheduledAnswer(a,true,a.next),d=scheduledAnswer(b,true,b.next);
 assert.equal(a.interval,1);assert.equal(a.next,now+86400000);assert.equal(b.interval,3);assert.ok(d.interval>3);assert.equal(c.next,0);
});
test('daily new budget counts distinct first attempts globally across decks',()=>{
 const state={cards:[fresh('A','A'),fresh('B','B')],reviews:[{cardId:'old',introduced:true,at:now-1},{cardId:'old',introduced:true,at:now-2},{cardId:'review',introduced:false,at:now-3}]};
 const p=reviewPlan(state,{now,newLimit:2,scope:new Set(['B'])});assert.equal(p.introducedToday,1);assert.deepEqual(ids(p),['B']);
 state.reviews.push({cardId:'other',introduced:true,at:now});assert.deepEqual(ids(reviewPlan(state,{now,newLimit:2})),[]);
});
test('calendar midnight resets allowance; future events do not consume it',()=>{
 const midnight=new Date(2026,10,11).getTime();
 const state={cards:[fresh()],reviews:[{cardId:'yesterday',introduced:true,at:midnight-1},{cardId:'future',introduced:true,at:now+1}]};
 assert.deepEqual(ids(reviewPlan(state,{now,newLimit:1})),['new']);
 state.reviews.push({cardId:'today',introduced:true,at:midnight});assert.deepEqual(ids(reviewPlan(state,{now,newLimit:1})),[]);
});
test('due cards remain available after the new-card allowance is exhausted',()=>{
 const state={cards:[fresh(),{...fresh('due'),next:now-1}],reviews:[{cardId:'first',introduced:true,at:now}]};
 assert.deepEqual(ids(reviewPlan(state,{now,newLimit:1})),['due']);
});
test('legacy history and missing timestamps do not invent new deadlines',()=>{
 const c={...fresh('legacy'),reps:3,interval:7,next:0};assert.equal(isReviewDue(c,now),true);
 const state={cards:[c],reviews:[{cardId:c.id,at:now}]};const before=JSON.stringify(state);reviewPlan(state,{now});assert.equal(JSON.stringify(state),before);
});
test('new-card limit defaults safely when storage is missing or corrupt',()=>{assert.equal(dailyNewLimit(),20);sandbox.localStorage.getItem=()=> '10';assert.equal(dailyNewLimit(),10);sandbox.localStorage.getItem=()=> 'bogus';assert.equal(dailyNewLimit(),20);});
