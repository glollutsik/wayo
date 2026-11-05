import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSettings,schedule,chooseMode,buildPlan} from '../lib/planner.mjs';
import {classify} from '../lib/places.mjs';
import {parseLine,normalizeRoute} from '../lib/provider.mjs';
const raw={date:'2027-01-10',days:1,startTime:'10:00',endTime:'20:00',mode:'walking',pace:'normal',lunch:1,dinner:1,coffee:1,dinnerDuration:90,returnToStart:true};
const start={id:'1',name:'Старт',lat:59.94,lon:30.31};
const place=(id,duration=60)=>({id,name:'Место '+id,lat:59.93,lon:30.32,kind:'visit',category:'Место',roles:[],duration});
const route=async(a,b,mode)=>({mode,duration:a.id===b.id?0:600,geometry:[],transfers:0});
const router={get:route};
test('normal reserve is counted once, 120-minute museum unchanged',async()=>{const s=validateSettings({...raw,startTime:'12:00'});assert.equal(s.reserve,3600);const d=await schedule([{kind:'visit',place:place('2',120),duration:120}],start,s,0,router);assert.equal(d.summary.visits,7200);assert.equal(d.summary.travel,1200);assert.equal(Object.values({v:d.summary.visits,f:d.summary.food,t:d.summary.travel,i:d.summary.free}).reduce((a,b)=>a+b),28800);assert.equal(d.items.find(x=>x.kind==='visit').duration,7200);});
test('return journey can make a day impossible',async()=>{const s=validateSettings({...raw,startTime:'10:00',endTime:'12:00',lunch:0,dinner:0,coffee:0});assert.equal(await schedule([{kind:'visit',place:place('2',100),duration:100}],start,s,0,router),null);});
test('unavailable route never becomes zero',async()=>{assert.equal(await schedule([{kind:'visit',place:place('2'),duration:60}],start,validateSettings(raw),0,{get:async()=>null}),null);});
test('walking wins near ties but not much faster transit',()=>{assert.equal(chooseMode({duration:1100,mode:'walking'},{duration:900,mode:'transit'}).mode,'walking');assert.equal(chooseMode({duration:1600,mode:'walking'},{duration:900,mode:'transit'}).mode,'transit');});
test('coffee shop does not get lunch role from its name',()=>{assert.deepEqual(classify({name:'Ресторан отличный',rubrics:[{name:'Кофейни'}]}).roles,['coffee']);assert.ok(classify({rubrics:[{name:'Рестораны'}]}).roles.includes('lunch'));});
test('WKT altitude does not corrupt longitude/latitude',()=>{assert.deepEqual(parseLine('LINESTRING(30.1 59.1 9000, 30.2 59.2 9000)'),[[30.1,59.1],[30.2,59.2]]);assert.equal(normalizeRoute({total_distance:500},'walking'),null);});
test('invalid parameters rejected before routing',()=>{assert.throws(()=>validateSettings({...raw,endTime:'09:00'}));assert.throws(()=>validateSettings({...raw,date:'2027-02-30'}));assert.doesNotThrow(()=>validateSettings({...raw,endTime:'18:00'}));});
test('realistic plan has unique stops, optional saved eatery and complete time budget',async()=>{const food={...place('3'),kind:'food',roles:['coffee','lunch','dinner']};const plan=await buildPlan([place('2',120),food,place('4',30)],start,raw,{source:route});const d=plan.days[0];assert.equal(d.items.filter(x=>x.kind==='visit').length,2);assert.equal(d.items.filter(x=>x.kind==='coffee'&&!x.place).length,0);assert.equal(d.items.filter(x=>['lunch','dinner','coffee'].includes(x.kind)).length,1);assert.equal(d.items.filter(x=>['lunch','dinner','coffee'].includes(x.kind)&&!x.place).length,0);const ids=d.items.filter(x=>x.place).map(x=>x.place.id);assert.equal(ids.length,new Set(ids).size);assert.equal(d.summary.visits+d.summary.food+d.summary.travel+d.summary.free,d.end-d.start);for(let i=1;i<d.items.length;i++)assert.equal(d.items[i].start,d.items[i-1].end);assert.equal(plan.included+plan.excluded.length,3);});
test('same selected set prefers time over input order',async()=>{const a=place('2',30),b=place('3',30);const matrix={'1:2':1800,'1:3':60,'2:3':1800,'3:2':60};const source=async(x,y,mode)=>({mode,duration:matrix[x.id+':'+y.id]||60,geometry:[],transfers:0});const p=await buildPlan([a,b],start,{...raw,lunch:0,dinner:0,coffee:0,returnToStart:false},{source});assert.deepEqual(p.days[0].items.filter(x=>x.place).map(x=>x.place.id),['3','2']);});
test('too many cafes never creates extra meals',async()=>{const cafes=Array.from({length:10},(_,i)=>({...place(String(10+i)),kind:'food',roles:['coffee']}));const p=await buildPlan([place('2'),...cafes],start,raw,{source:route});assert.equal(p.days[0].items.filter(x=>x.place?.kind==='food').length,1);assert.equal(p.excluded.length,9);});
test('no phantom coffees are generated when there are no coffee venues',async()=>{const p=await buildPlan([place('2',60)],start,{...raw,coffee:2},{source:route});assert.equal(p.days[0].items.filter(x=>x.kind==='coffee').length,0);});
test('time-sensitive route growth never returns an overflowing day',async()=>{const source=async(a,b,mode,departure)=>({mode,duration:(new Date(departure).getUTCHours()<9?2400:600),geometry:[],transfers:0});const p=await buildPlan([place('2',60),place('3',30)],start,{...raw,endTime:'14:00',dinner:0,lunch:0,coffee:0},{source});assert.ok(p.days[0].items.every(x=>x.end<=p.days[0].end));});
test('coffee can move after a visit when morning detour exceeds fifteen minutes',async()=>{const cafe={...place('9'),kind:'food',roles:['coffee']};const source=async(a,b,mode)=>({mode,duration:a.id==='1'&&b.id==='9'?2000:60,geometry:[],transfers:0});const p=await buildPlan([place('2'),cafe],start,{...raw,lunch:0,dinner:0,returnToStart:false},{source});const selected=p.days[0].items.filter(x=>x.place);assert.deepEqual(selected.map(x=>x.kind),['visit','coffee']);});
test('one failed candidate leg does not cancel the entire itinerary',async()=>{
  const {AppError}=await import('../lib/provider.mjs');
  const cafe={...place('9'),kind:'food',roles:['coffee']};
  const source=async(a,b,mode)=>{if(a.id==='1'&&b.id==='9')throw new AppError('Gateway unavailable',502,'UPSTREAM');return route(a,b,mode);};
  const p=await buildPlan([place('2'),cafe],start,{...raw,lunch:0,dinner:0,returnToStart:false},{source});
  assert.ok(p.days[0].items.some(x=>x.kind==='visit'));assert.ok(p.stats.failedRequests>0);assert.ok(p.warnings.length>0);
});
test('automatic breaks fit a short afternoon instead of requiring an impossible dinner',()=>{
  const {lunch,dinner,coffee,dinnerDuration,...automatic}=raw;
  const s=validateSettings({...automatic,startTime:'15:00',endTime:'17:00'});
  assert.equal(s.lunch,0);assert.equal(s.dinner,0);assert.equal(s.coffee,0);
});
test('coffee, restaurant and museum primary categories are not mixed by secondary services',()=>{
  assert.equal(classify({rubrics:[{name:'Музеи',kind:'primary'},{name:'Кафе',kind:'additional'}]}).kind,'visit');
  assert.deepEqual(classify({rubrics:[{name:'Кофейни',kind:'primary'},{name:'Кафе',kind:'additional'}]}).roles,['coffee']);
  assert.equal(classify({rubrics:[{name:'Рестораны',kind:'primary'},{name:'Бары',kind:'additional'}]}).category,'Ресторан');
  assert.equal(classify({type:'branch',name:'Дворцовая площадь',rubrics:[]}).category,'Городская точка');
  assert.equal(classify({rubrics:[{name:'Культурно-досуговые центры',kind:'primary'}]}).category,'Культурное пространство');
});
test('initially excluded sight is retried after a connecting sight is added',async()=>{
  const a=place('2',120),b=place('3',30);
  const source=async(x,y,mode)=>x.id==='1'&&y.id==='2'?null:route(x,y,mode);
  const p=await buildPlan([a,b],start,{...raw,lunch:0,dinner:0,coffee:0,returnToStart:false},{source});
  assert.deepEqual(p.days[0].items.filter(x=>x.kind==='visit').map(x=>x.place.id),['3','2']);
  assert.equal(p.excluded.length,0);
});
test('return journey remains included without a phantom dinner',async()=>{
  const source=async(a,b,mode)=>({mode,duration:a.id===b.id?0:40*60,geometry:[],transfers:0});
  const p=await buildPlan([place('2',120)],start,{...raw,coffee:0},{source});
  assert.equal(p.included,1);const d=p.days[0];
  const back=d.items.findIndex(x=>x.kind==='travel'&&x.to===start.id);
  assert.ok(back>=0);assert.equal(d.items.filter(x=>x.kind==='dinner').length,0);assert.equal(d.items.filter(x=>x.kind==='travel').length,2);
  assert.ok(d.items.every(x=>x.end<=d.end));
});

test('prototype rejects multiple days before any provider request',async()=>{
 let calls=0;await assert.rejects(buildPlan([place('2')],start,{...raw,days:2},{source:async()=>{calls++;return null;}}),e=>e.code==='INPUT');assert.equal(calls,0);
});

test('a full day with no eateries reserves no meal time and fits all three long visits',async()=>{
 const {lunch,dinner,coffee,dinnerDuration,...settings}=raw;
 const p=await buildPlan([place('2',150),place('3',150),place('4',150)],start,settings,{source:route});
 assert.equal(p.included,3);assert.equal(p.excluded.length,0);assert.equal(p.days[0].summary.food,0);
 assert.ok(!p.days[0].items.some(x=>['lunch','dinner','coffee'].includes(x.kind)));
});
test('optional eateries cannot displace sights that fit the day',async()=>{
 const restaurant={...place('9'),kind:'food',roles:['lunch','dinner']};
 const p=await buildPlan([place('2',150),place('3',150),place('4',150),restaurant],start,raw,{source:route});
 assert.equal(p.days[0].items.filter(x=>x.kind==='visit').length,3);
 assert.equal(p.excluded.length,1);assert.equal(p.excluded[0].place.id,'9');
});
