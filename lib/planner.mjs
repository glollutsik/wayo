import {setTimeout as delay} from 'node:timers/promises';
import {inBounds, config} from './config.mjs';
import {route as providerRoute, AppError} from './provider.mjs';
export const MIN=60;
const seconds=t=>{if(!/^\d{2}:\d{2}$/.test(t||''))throw new AppError('Проверьте время дня.',400,'INPUT');const [h,m]=t.split(':').map(Number);if(h>23||m>59)throw new AppError('Неверное время.',400,'INPUT');return (h*60+m)*60;};
export function validateSettings(raw) {
  const s={date:raw.date,days:Number(raw.days),startTime:raw.startTime,endTime:raw.endTime,mode:raw.mode,pace:raw.pace,lunch:raw.lunch==null?null:Number(raw.lunch),dinner:raw.dinner==null?null:Number(raw.dinner),coffee:raw.coffee==null?null:Number(raw.coffee),dinnerDuration:Number(raw.dinnerDuration??90),returnToStart:!!raw.returnToStart};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s.date||'') || !Number.isFinite(Date.parse(s.date+'T00:00:00+03:00')) || new Date(s.date+'T12:00:00Z').toISOString().slice(0,10)!==s.date)throw new AppError('Выберите действительную дату.',400,'INPUT');
  if(s.date < new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))throw new AppError('Выберите сегодняшнюю или будущую дату.',400,'INPUT');
  s.start=seconds(s.startTime);s.end=seconds(s.endTime);
  s.lunch??=Number(s.start<=15*3600&&s.end>=12*3600+45*60&&s.end-s.start>=3*3600);
  s.dinner??=Number(s.start<=21*3600&&s.end>=18*3600+90*60&&s.end-s.start>=5*3600);
  s.coffee??=Number(s.end-s.start>=4*3600);
  if(!(Number.isInteger(s.days)&&s.days===1)||!['walking','mixed','driving'].includes(s.mode)||!['calm','normal','busy'].includes(s.pace)||![0,1].includes(s.lunch)||![0,1].includes(s.dinner)||![0,1,2].includes(s.coffee)||![90,120].includes(s.dinnerDuration))throw new AppError('Проверьте параметры поездки. Маршрут строится на один день.',400,'INPUT');
  s.start=seconds(s.startTime);s.end=seconds(s.endTime);
  if(s.end<=s.start)throw new AppError('Окончание дня должно быть позже начала.',400,'INPUT');
  s.reserve=Math.round(((s.end-s.start)/3600)*({calm:45,normal:30,busy:15}[s.pace])/4/5)*5*60;
  return s;
}
export function chooseMode(walk,transit) {
  if(!walk)return transit;if(!transit)return walk;
  return walk.duration<=transit.duration+300?walk:transit;
}
export function makeRouter(settings, signal, source=providerRoute) {
  const memo=new Map();const failedPlaces=new Set();let failedRequests=0;let count=0;let active=0;let nextLaunch=0;const queue=[];
  const interval=source===providerRoute?config.routingInterval:0;
  async function limited(fn){
    if(active>=3)await new Promise(resolve=>queue.push(resolve));active++;
    try{
      const at=Math.max(Date.now(),nextLaunch);nextLaunch=at+interval;
      if(at>Date.now())await delay(at-Date.now(),undefined,{signal});
      if(signal?.aborted)throw new AppError('Время расчёта истекло. Попробуйте меньше мест.',504,'TIMEOUT');
      return await fn();
    }finally{active--;queue.shift()?.();}
  }
  const request=async(a,b,mode,departure)=> {
    if(signal?.aborted)throw new AppError('Время расчёта истекло. Попробуйте меньше мест или другой транспорт.',504,'TIMEOUT');
    count++;
    return limited(async()=>{
      try{return await source(a,b,mode,departure,signal);}
      catch(e){
        if(!signal?.aborted&&['UPSTREAM','NETWORK','FORMAT'].includes(e.code)){
          failedRequests++;failedPlaces.add(a.id);failedPlaces.add(b.id);return null;
        }
        throw e;
      }
    });
  };
  const get=(a,b,departure,exact=false)=>{
    // Walking has no departure-time input; car API uses current traffic, not a future departure.
    const bucket=settings.mode==='mixed'&&exact?Math.floor(departure/1000):'base';
    const key=`${a.id}:${b.id}:${bucket}`;
    if(!memo.has(key))memo.set(key,(async()=>{
      const date=exact?departure:Date.parse(settings.date+'T12:00:00+03:00');
      if(settings.mode==='mixed') {
        const [walking,transit]=await Promise.all([request(a,b,'walking',date),request(a,b,'transit',date)]);
        return chooseMode(walking,transit);
      }
      return request(a,b,settings.mode,date);
    })());
    return memo.get(key);
  };
  return {get,failedPlaces,stats:()=>({requests:count,failedRequests})};
}
const dayDate=(date,index)=>new Date(Date.parse(date+'T12:00:00+03:00')+index*86400000).toISOString().slice(0,10);
const event=(kind,place=null,duration=null)=>({kind,place,duration:duration??(kind==='visit'?place.duration:kind==='coffee'?15:kind==='lunch'?45:90)});
export async function schedule(tokens, startPoint, s, index, router, exact=false) {
  let time=s.start, current=startPoint, reserve=s.reserve, travel=0, visits=0, food=0, idle=0, transfers=0, waiting=0;
  const items=[], date=dayDate(s.date,index), epoch=Date.parse(date+'T00:00:00+03:00');
  function pause(duration,label='Свободное время') {if(duration<=0)return;items.push({kind:'free',name:label,start:time,end:time+duration,duration});time+=duration;idle+=duration;reserve=Math.max(0,reserve-duration);}
  const visitCount=tokens.filter(t=>t.kind==='visit').length;
  const chunk=visitCount?Math.min(900,Math.floor(s.reserve/(visitCount+1)/300)*300):0;
  for(let i=0;i<tokens.length;i++) {
    const t=tokens[i];
    if(t.kind!=='visit'&&!t.place)continue;
    if(t.place) {
      const r=await router.get(current,t.place,epoch+time*1000,exact);
      if(!r)return null;
      items.push({kind:'travel',from:current.id,to:t.place.id,start:time,end:time+r.duration,...r});
      time+=r.duration;travel+=r.duration;transfers+=r.transfers||0;current=t.place;
    }
    const window=t.kind==='lunch'?[12*3600,15*3600]:t.kind==='dinner'?[18*3600,21*3600]:null;
    if(window){if(time>window[1])return null;const wait=Math.max(0,window[0]-time);waiting+=wait;pause(wait,'Свободное время до '+(t.kind==='lunch'?'обеда':'ужина'));}
    const duration=t.duration*60;
    if(time+duration>s.end)return null;
    items.push({kind:t.kind,place:t.place,name:t.place.name,start:time,end:time+duration,duration,unlocated:false});
    time+=duration;
    if(t.kind==='visit'){visits+=duration;pause(Math.min(chunk,reserve));}else food+=duration;
  }
  if(s.returnToStart && current.id!==startPoint.id) {
    const r=await router.get(current,startPoint,epoch+time*1000,exact);if(!r)return null;
    items.push({kind:'travel',from:current.id,to:startPoint.id,start:time,end:time+r.duration,...r});time+=r.duration;travel+=r.duration;transfers+=r.transfers||0;
  }
  pause(reserve);
  if(time>s.end)return null;
  // Keep a complete day and expose all remaining slack, counted once.
  pause(s.end-time);
  return {index,date,start:s.start,end:s.end,items,summary:{visits,food,travel,free:idle,reserve:s.reserve,transfers,waiting},tokens};
}
const visitTokens=day=>day.tokens.filter(t=>t.kind==='visit');
const visitPlaces=day=>visitTokens(day).map(t=>t.place);
const occupied=day=>day.summary.visits+day.summary.travel;
function quality(days){
  const counts=days.map(d=>visitTokens(d).length),loads=days.map(occupied);
  const active=counts.filter(n=>n>0).length;
  return [-active,Math.max(...counts)-Math.min(...counts),Math.max(...loads)-Math.min(...loads),days.reduce((n,d)=>n+d.summary.travel,0)];
}
function compareQuality(a,b){const x=quality(a),y=quality(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;}
async function insertToken(tokens,t,startPoint,s,index,router){
  const variants=await Promise.all(Array.from({length:tokens.length+1},(_,pos)=>schedule([...tokens.slice(0,pos),t,...tokens.slice(pos)],startPoint,s,index,router)));
  return variants.filter(Boolean).sort((a,b)=>a.summary.travel-b.summary.travel||a.summary.waiting-b.summary.waiting)[0]||null;
}
async function decorate(visits,foods,used,start,s,index,router){
  let tokens=visits.map(p=>event('visit',p));
  let best=await schedule(tokens,start,s,index,router);if(!best)return null;
  const localUsed=new Set(used);
  // Eateries are optional additions after sights fit. Never reserve an empty meal.
  for(const kind of ['lunch','dinner'])if(s[kind]){
    const choices=await Promise.all(foods.filter(p=>p.roles.includes(kind)&&!localUsed.has(p.id)).map(p=>insertToken(tokens,event(kind,p,kind==='dinner'?s.dinnerDuration:45),start,s,index,router)));
    const chosen=choices.filter(Boolean).sort((a,b)=>a.summary.travel-b.summary.travel||a.summary.waiting-b.summary.waiting)[0];
    if(chosen){tokens=chosen.tokens;best=chosen;for(const t of tokens)if(t.place&&t.kind!=='visit')localUsed.add(t.place.id);}
  }
  // Coffee exists only when an actual saved venue can be fitted in.
  for(let i=0;i<s.coffee;i++){
    const candidates=foods.filter(p=>p.roles.includes('coffee')&&!localUsed.has(p.id));
    if(!candidates.length)break;
    const choices=await Promise.all(candidates.flatMap(p=>Array.from({length:tokens.length+1},async(_,pos)=>{
      const next=[...tokens.slice(0,pos),event('coffee',p),...tokens.slice(pos)];
      const coffees=next.flatMap((t,j)=>t.kind==='coffee'?[j]:[]);
      if(coffees.length>1&&!next.slice(coffees[0]+1,coffees[1]).some(t=>t.kind==='visit'))return null;
      const d=await schedule(next,start,s,index,router);if(!d)return null;
      const firstVisit=next.findIndex(t=>t.kind==='visit');
      return {d,early:i===0&&(firstVisit<0||pos<firstVisit)&&d.summary.travel-best.summary.travel<=15*60};
    })));
    const chosen=choices.filter(Boolean).sort((a,b)=>Number(b.early)-Number(a.early)||a.d.summary.travel-b.d.summary.travel||a.d.summary.waiting-b.d.summary.waiting)[0];
    if(!chosen)break;
    best=chosen.d;tokens=best.tokens;for(const t of tokens)if(t.place&&t.kind!=='visit')localUsed.add(t.place.id);
  }
  return best;
}
export async function buildPlan(places,start,raw,{signal,source}={}) {
  const s=validateSettings(raw);
  if(!inBounds(start)||!places.length||places.length>20||places.some(p=>!inBounds(p)))throw new AppError('Добавьте от 1 до 20 мест и стартовую точку в Санкт-Петербурге.',400,'INPUT');
  if(new Set(places.map(p=>p.id)).size!==places.length)throw new AppError('Удалите повторяющиеся места.',400,'INPUT');
  const router=makeRouter(s,signal,source),foods=places.filter(p=>p.kind==='food'),visits=places.filter(p=>p.kind==='visit');
  const emptySettings={...s,lunch:0,dinner:0,coffee:0};
  const activeCount=Math.min(s.days,visits.length||Math.max(1,Math.ceil(foods.length/3)));
  const targets=Array.from({length:s.days},(_,i)=>i<activeCount?Math.floor(visits.length/activeCount)+(i<visits.length%activeCount?1:0):0);
  let days=await Promise.all(Array.from({length:s.days},(_,i)=>schedule([],start,emptySettings,i,router)));
  const allUsed=(except=-1)=>new Set(days.flatMap((d,i)=>i===except?[]:d.tokens.filter(t=>t.place).map(t=>t.place.id)));
  async function bestInsertion(p,actual=false){
    const choices=await Promise.all(days.flatMap((day,di)=>Array.from({length:visitPlaces(day).length+1},async(_,pos)=>{
      const current=visitPlaces(day),next=[...current.slice(0,pos),p,...current.slice(pos)];
      const r=actual?{get:(a,b,t)=>router.get(a,b,t,true)}:router;
      const d=await decorate(next,[],new Set(),start,s,di,r);
      return d?{di,d,count:next.length}:null;
    })));
    return choices.filter(Boolean).sort((a,b)=>
      Math.max(0,a.count-targets[a.di])-Math.max(0,b.count-targets[b.di])||
      visitTokens(days[a.di]).length-visitTokens(days[b.di]).length||
      occupied(a.d)-occupied(b.d)||a.d.summary.travel-b.d.summary.travel)[0];
  }
  // Failed insertion is not a permanent exclusion: an intermediate stop added later
  // may make that same sight reachable. Retry until the selected set stops growing.
  async function fill(actual=false){
    let pending=visits.filter(p=>!allUsed().has(p.id)).sort((a,b)=>b.duration-a.duration||a.id.localeCompare(b.id));
    while(pending.length){let progress=false;const rest=[];
      for(const p of pending){const chosen=await bestInsertion(p,actual);if(chosen){days[chosen.di]=chosen.d;progress=true;}else rest.push(p);}
      if(!progress)break;pending=rest;
    }
  }
  await fill();
  // Try swaps and moves across days, plus arbitrary reorderings inside each day.
  // The selected set is preserved; balance is evaluated before travel savings.
  async function improve(actual=false){
    const r=actual?{get:(a,b,t)=>router.get(a,b,t,true)}:router;
    for(let pass=0;pass<2;pass++){
      let changed=false;
      for(let from=0;from<days.length;from++){
        const current=visitPlaces(days[from]);
        for(let a=0;a<current.length;a++)for(let b=a+1;b<current.length;b++){
          const next=visitPlaces(days[from]);[next[a],next[b]]=[next[b],next[a]];
          const d=await decorate(next,[],new Set(),start,s,from,r);
          if(d&&d.summary.travel<days[from].summary.travel){days[from]=d;changed=true;}
        }
        for(let to=0;to<activeCount;to++)if(to!==from){
          const left=visitPlaces(days[from]),right=visitPlaces(days[to]);
          if(left.length>right.length+1)for(const p of left){
            const donor=await decorate(left.filter(x=>x.id!==p.id),[],new Set(),start,s,from,r);if(!donor)continue;
            for(let pos=0;pos<=right.length;pos++){
              const target=await decorate([...right.slice(0,pos),p,...right.slice(pos)],[],new Set(),start,s,to,r);
              if(!target)continue;const candidate=[...days];candidate[from]=donor;candidate[to]=target;
              if(compareQuality(candidate,days)<0){days=candidate;changed=true;break;}
            }
            if(visitTokens(days[from]).length!==left.length)break;
          }
          // Swapping can make two previously incompatible day clusters feasible.
          if(pass===0&&left.length&&right.length)for(const p of left)for(const q of right){
            const [d1,d2]=await Promise.all([
              decorate(left.map(x=>x.id===p.id?q:x),[],new Set(),start,s,from,r),
              decorate(right.map(x=>x.id===q.id?p:x),[],new Set(),start,s,to,r),
            ]);
            if(!d1||!d2)continue;const candidate=[...days];candidate[from]=d1;candidate[to]=d2;
            const currentIds=candidate.flatMap(visitPlaces).map(x=>x.id);
            if(new Set(currentIds).size===currentIds.length&&compareQuality(candidate,days)<0){days=candidate;changed=true;}
          }
        }
      }
      if(!changed)break;
    }
  }
  await improve();await fill();
  // Validate real departure times before selecting optional food venues.
  for(let di=0;di<days.length;di++){
    if(!visitTokens(days[di]).length)continue;
    const r={get:(a,b,t)=>router.get(a,b,t,true)};
    let current=visitPlaces(days[di]);
    let exact=await decorate(current,[],new Set(),start,s,di,r);
    while(!exact&&current.length){
      const repairs=await Promise.all(current.map((_,drop)=>decorate(current.filter((p,i)=>i!==drop),[],new Set(),start,s,di,r)));
      exact=repairs.filter(Boolean).sort((a,b)=>visitTokens(b).length-visitTokens(a).length||a.summary.travel-b.summary.travel)[0];
      if(exact)break;current=current.slice(0,-1);
    }
    days[di]=exact||await schedule([],start,emptySettings,di,router);
  }
  // A later-day repair can free capacity. Reconsider excluded sights and balance again.
  await fill(true);await improve(true);await fill(true);
  for(let di=0;di<days.length;di++){
    const current=visitPlaces(days[di]),r={get:(a,b,t)=>router.get(a,b,t,true)};
    if(!current.length&&(visits.length||di>=activeCount)){days[di]={...await schedule([],start,emptySettings,di,router),empty:true};continue;}
    const decorated=await decorate(current,foods,allUsed(di),start,s,di,r);
    if(decorated)days[di]=decorated;
    // Optional food must never decrease the count of successfully planned sights.
  }
  const used=allUsed();
  if(!used.size){if(router.stats().failedRequests)throw new AppError('Не удалось получить достаточно данных маршрутизации 2ГИС. Повторите расчёт позже.',502,'UPSTREAM');throw new AppError('Ни одно место не удалось включить в маршрут. Проверьте время дня и транспорт.',400,'EMPTY');}
  const excluded=places.filter(p=>!used.has(p.id)).map(place=>({place,reason:router.failedPlaces.has(place.id)?'Не включено: для части путей к этому месту не удалось получить данные 2ГИС.':place.kind==='food'?'Для выбранного количества остановок выбраны другие заведения или не найден подходящий путь.':'Не поместилось по времени или не найден доступный путь.'}));
  return {settings:s,start,days:days.map(({tokens,...day})=>day),excluded,included:used.size,total:places.length,stats:router.stats(),warnings:[...(s.days>visits.length&&visits.length?['Основных мест меньше, чем дней поездки. Дни без посещений оставлены свободными.']:[]),...(router.stats().failedRequests?['Для части участков 2ГИС не вернул данные. Эти участки не использованы; некоторые места могли не попасть в маршрут.']:[]),...(s.mode==='driving'?['Автомобильные маршруты рассчитаны по текущей дорожной обстановке. Парковка и путь от неё не учтены.']:[]),...(s.mode==='mixed'?['Время транспорта оценочное и зависит от доступных расписаний 2ГИС.']:[])]};
}
