'use strict';
const REVIEW_DAY_MS = 86400000;
const NEW_CARD_LIMIT_KEY = 'lexicards-new-card-limit';
function isNewCard(card) { return Number(card.reps || 0) === 0 && Number(card.interval || 0) === 0 && Number(card.next || 0) === 0; }
function isReviewDue(card,now = Date.now()) { return !isNewCard(card) && Number(card.next || 0) <= now; }
function reviewStatus(card,now = Date.now()) { return isNewCard(card) ? 'new' : isReviewDue(card,now) ? 'due' : 'later'; }
function dailyNewLimit() {
 try { const value=Number(localStorage.getItem(NEW_CARD_LIMIT_KEY));return [5,10,20,50].includes(value)?value:20; }
 catch (_) { return 20; }
}
function reviewPlan(state,{scope=null,now=Date.now(),newLimit=20} = {}) {
 const cards=state.cards.filter(c=>!scope||scope.has(c.deck));
 const midnight=new Date(now);midnight.setHours(0,0,0,0);
 const introduced=new Set((state.reviews||[]).filter(r=>r.introduced && r.at>=midnight.getTime() && r.at<=now).map(r=>r.cardId));
 const remaining=Math.max(0,Math.floor(newLimit)-introduced.size);
 const dueCards=cards.map((card,index)=>({card,index})).filter(x=>isReviewDue(x.card,now)).sort((a,b)=>(a.card.next||0)-(b.card.next||0)||a.index-b.index).map(x=>x.card);
 const newCards=cards.filter(isNewCard),selectedNew=newCards.slice(0,remaining);
 const later=cards.filter(c=>reviewStatus(c,now)==='later');
 return {due:dueCards,newCards,selectedNew,later,cards:[...dueCards,...selectedNew],introducedToday:introduced.size,newRemaining:remaining,nextAt:later.length?Math.min(...later.map(c=>c.next)):null};
}
function scheduledAnswer(card,known,now = Date.now()) {
 const next={...card};
 if(known){
  next.reps=(next.reps||0)+1;
  next.interval=next.reps===1?1:next.reps===2?3:Math.min(36500,Math.round((next.interval||3)*(next.ease||2.5)));
  next.ease=Math.min(5,(next.ease||2.5)+0.1);
  next.next=now+next.interval*REVIEW_DAY_MS;
 }else{
  next.reps=0;next.interval=0;next.ease=Math.max(1.3,(next.ease||2.5)-0.2);next.next=now+10*60000;
 }
 return next;
}
function reviewDateLabel(card,now = Date.now()) {
 const state=reviewStatus(card,now);
 if(state==='new')return 'Новое слово';
 const date=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(card.next);
 return state==='due' ? (card.next>0?'Пора: '+date:'Пора повторить') : 'Повторить '+date;
}
function saveDailyNewLimit(value) {
 const limit=Number(value);if(![5,10,20,50].includes(limit))return;
 try{localStorage.setItem(NEW_CARD_LIMIT_KEY,String(limit));renderAll();showToast('Новых слов в день: '+limit);}
 catch(e){$('dailyNewLimit').value=String(dailyNewLimit());showToast('Не удалось сохранить настройку');}
}
