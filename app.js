import {setupScreenshotImport} from './ocr-ui.js';
const $=s=>document.querySelector(s);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const form=$('#trip-form');let places=[],start=null,plan=null,dayIndex=0,dirty=false,map=null,mapObjects=[],pins=new Map(),building=false,revision=0;
const modeLabel={walking:'Пешком',transit:'Общественный транспорт',driving:'На автомобиле'};
const time=s=>{const minutes=Math.ceil(s/60);return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;};
const duration=s=>{const m=Math.ceil(s/60);return m>=60?`${Math.floor(m/60)} ч${m%60?' '+m%60+' мин':''}`:`${m} мин`;};
let toastTimer;
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
async function api(url,options){let r;try{r=await fetch(url,options);}catch{throw new Error('Сервер недоступен. Проверьте, запущено ли приложение.');}let data;try{data=await r.json();}catch{throw new Error('Не удалось прочитать ответ сервера.');}if(!r.ok)throw new Error(data.error||'Не удалось выполнить запрос.');return data;}
function settings(){const data=Object.fromEntries(new FormData(form));data.returnToStart=form.elements.returnToStart.checked;data.days=1;return data;}
function save(){try{localStorage.setItem('wayo-planner-v1',JSON.stringify({ids:places.map(p=>p.id),startId:start?.id,settings:settings()}));}catch{toast('Браузер не разрешил сохранить черновик.');}}
function changed(){revision++;if(plan){dirty=true;$('#stale').hidden=false;}save();}
function renderCollection(){
  $('#place-count').textContent=`${places.length} / 20`;$('#collection-empty').hidden=places.length>0;
  $('#places').innerHTML=places.map((p,i)=>`<div class="place"><span class="place-num">${i+1}</span><div class="place-info"><strong>${escape(p.name)}</strong><small>${escape(p.category)}</small><small>${escape(p.address)}</small></div><button type="button" class="remove" data-remove="${escape(p.id)}" aria-label="Удалить ${escape(p.name)}">×</button></div>`).join('');
  $('#start-selected').innerHTML=start?`<div class="selected-start"><strong>${escape(start.name)}</strong><small>${escape(start.address)}</small></div>`:'';
  $('#build').disabled=building||!places.length;renderMap();
}
function setupSearch(inputId,resultId,statusId,onChoose){
  const input=$(inputId),results=$(resultId),status=$(statusId);let timer,controller,version=0;
  input.addEventListener('input',()=>{
    clearTimeout(timer);controller?.abort();const v=++version;results.replaceChildren();status.textContent='';
    const q=input.value.trim();if(q.length<3)return;
    timer=setTimeout(async()=>{
      controller=new AbortController();status.textContent='Ищем в 2ГИС…';
      try{
        const data=await api('/api/search?q='+encodeURIComponent(q),{signal:controller.signal});if(v!==version)return;
        status.textContent=data.places.length?'Выбери нужное место':'В Петербурге ничего не найдено. Попробуй другое название или адрес.';
        for(const p of data.places){const button=document.createElement('button');button.className='result';button.type='button';button.innerHTML=`<span><strong>${escape(p.name)}</strong><small>${escape(p.address)}</small><small>${escape(p.category)}</small></span><span class="add" aria-hidden="true">+</span>`;button.addEventListener('click',()=>{if(onChoose(p)!==false){input.value='';results.replaceChildren();status.textContent='';version++;}});results.append(button);}
      }catch(e){if(v===version&&!controller.signal.aborted)status.textContent=e.message;}
    },400);
  });
  input.addEventListener('keydown',e=>{if(e.key==='Escape'){controller?.abort();version++;results.replaceChildren();status.textContent='';}});
}
function addPlace(p){if(places.some(x=>x.id===p.id)){toast('Место уже добавлено');return false;}if(places.length>=20){toast('В первой версии можно добавить до 20 мест');return false;}places.push(p);changed();renderCollection();return true;}
setupSearch('#search','#search-results','#search-status',addPlace);
setupScreenshotImport({api,addPlace,canAdd:()=>places.length<20,notify:toast});
setupSearch('#start-search','#start-results','#start-status',p=>{start=p;changed();renderCollection();});
$('#places').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(b){places=places.filter(p=>p.id!==b.dataset.remove);changed();renderCollection();}});
form.addEventListener('change',e=>{if(e.target.name)changed();});
form.addEventListener('submit',async e=>{
  e.preventDefault();if(building)return;$('#form-error').hidden=true;
  if(!start){$('#form-error').textContent='Выбери стартовую точку через поиск.';$('#form-error').hidden=false;$('#start-search').focus();return;}
  if(!places.length)return;
  building=true;const builtRevision=revision;$('#build').disabled=true;$('#build').setAttribute('aria-busy','true');$('#build span').textContent='Составляем маршрут…';
  const begun=Date.now();const tick=setInterval(()=>{$('#build-progress').textContent=Date.now()-begun<10000?'Подбираем маршрут через 2ГИС…':'Сравниваем время пути и порядок остановок.';},1500);
  try{
    const data=await api('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:places.map(p=>p.id),startId:start.id,settings:settings()})});
    plan=data;dayIndex=0;dirty=builtRevision!==revision;$('#stale').hidden=!dirty;$('#plan-section').hidden=false;document.body.classList.add('has-plan');renderPlan();$('#plan-section').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
    toast('Маршрут составлен');
  }catch(err){$('#form-error').textContent=err.message;$('#form-error').hidden=false;$('#form-error').focus();if(plan){dirty=true;$('#stale').hidden=false;}}
  finally{clearInterval(tick);building=false;$('#build').disabled=!places.length;$('#build').removeAttribute('aria-busy');$('#build span').textContent=plan?'Пересчитать маршрут':'Составить маршрут';$('#build-progress').textContent='';}
});
function renderPlan(){
  if(!plan)return;const day=plan.days[dayIndex];
  $('#included-count').textContent=`${plan.included} из ${plan.total} мест`;
  $('#day-tabs').innerHTML=plan.days.map((d,i)=>`<button type="button" data-day="${i}" aria-pressed="${i===dayIndex}">День ${i+1} · ${new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',timeZone:'Europe/Moscow'}).format(new Date(d.date+'T12:00:00+03:00'))}</button>`).join('');
  $('#plan-warnings').innerHTML=plan.warnings.map(w=>`<p class="hint">${escape(w)}</p>`).join('');
  const shownTravel=day.items.filter(x=>x.kind==='travel').reduce((n,x)=>n+(Math.ceil(x.end/60)-Math.ceil(x.start/60))*60,0);
  const shownFree=day.end-day.start-day.summary.visits-day.summary.food-shownTravel;
  $('#summary').innerHTML=[['Посещения',day.summary.visits],['Еда и кофе',day.summary.food],['В пути',shownTravel],['Свободное время',shownFree]].map(([label,n])=>`<div><strong>${duration(n)}</strong><small>${label}</small></div>`).join('');
  let number=0;
  $('#timeline').innerHTML=(day.empty?'<div class="empty-day"><h3>Свободный день</h3><p>В этот день нет запланированных мест.</p></div>':'')+`<p class="hint">${time(day.start)}–${time(day.end)} · старт: ${escape(plan.start.name)} · запас ${duration(day.summary.reserve)} входит в свободное время</p>`+day.items.map(item=>{
    if(item.kind==='travel')return `<div class="travel">${time(item.start)}–${time(item.end)} · ${modeLabel[item.mode]}${item.approximate?' · приблизительно':''} · ${duration((Math.ceil(item.end/60)-Math.ceil(item.start/60))*60)}${item.lines?.length?`<small>${escape(item.lines.join(', '))}${item.transfers?` · пересадок: ${item.transfers}`:''}</small>`:''}${item.duration>0&&!item.geometry.length?'<small>Геометрия участка недоступна, линия на карте не показана.</small>':''}</div>`;
    if(item.kind==='free')return `<div class="free">${time(item.start)}–${time(item.end)} · ${escape(item.name)} · ${duration((Math.ceil(item.end/60)-Math.ceil(item.start/60))*60)}</div>`;
    const n=item.place?++number:'—';
    const category=item.kind==='visit'?item.place.category:{coffee:'Кофебрейк',lunch:'Обед',dinner:'Ужин'}[item.kind];
    return `<article class="stop" ${item.place?`data-stop="${escape(item.place.id)}"`:''}><div class="stop-time">${time(item.start)}<br>${time(item.end)}</div><div class="stop-card"><header><span class="stop-index">${n}</span><h3>${escape(item.name)}</h3>${item.place?`<button type="button" data-focus="${escape(item.place.id)}">На карте</button>`:''}</header><p class="hint">${escape(category)} · ${duration(item.duration)}${item.place?.approximate?' · примерная оценка':''}</p>${item.unlocated?'<p class="hint">Время на поиск заведения и дорогу до него не учтено.</p>':`<p class="hint">${escape(item.place.address)}</p>`}</div></article>`;
  }).join('');
  $('#excluded-details').hidden=!plan.excluded.length;$('#excluded-heading').textContent=`Не включено в маршрут · ${plan.excluded.length}`;
  $('#excluded-list').innerHTML=plan.excluded.map(({place:p,reason})=>`<div class="excluded-row"><div><strong>${escape(p.name)}</strong><small>${escape(reason)}</small></div><button type="button" data-focus="${escape(p.id)}">На карте</button></div>`).join('');
  renderMap();
}
$('#day-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-day]');if(b){dayIndex=Number(b.dataset.day);renderPlan();}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-focus]');if(b)focusPlace(b.dataset.focus,true);});
function toggleMap(show){document.body.classList.toggle('map-view',show);$('#view-map').setAttribute('aria-pressed',String(show));$('#view-plan').setAttribute('aria-pressed',String(!show));requestAnimationFrame(()=>{map?.invalidateSize();if(show)$('.map-panel').scrollIntoView({block:'start',behavior:'smooth'});});}
$('#view-map').onclick=()=>toggleMap(true);$('#view-plan').onclick=()=>toggleMap(false);
function focusPlace(id,showMap=false){
  const p=[...places,start,plan?.start,...(plan?.excluded||[]).map(x=>x.place),...(plan?.days[dayIndex]?.items||[]).map(x=>x.place)].filter(Boolean).find(p=>p.id===id);if(!p)return;
  document.querySelectorAll('.stop-card.selected,.map-pin.selected').forEach(x=>x.classList.remove('selected'));
  pins.get(id)?.classList.add('selected');const card=document.querySelector(`[data-stop="${CSS.escape(id)}"] .stop-card`);card?.classList.add('selected');
  if(showMap){if(innerWidth<=700)toggleMap(true);else $('.map-panel').scrollIntoView({block:'center',behavior:'smooth'});}else if(card){if(innerWidth<=700)toggleMap(false);card.scrollIntoView({block:'center',behavior:'smooth'});}else toast(p.name);
  map?.setCenter([p.lon,p.lat]);map?.setZoom(15);
}
function renderMap(){
  if(!map||!window.mapgl)return;
  for(const o of mapObjects)o.destroy();mapObjects=[];pins.clear();
  const day=plan?.days[dayIndex];let marks=[];
  if(plan){marks.push({place:plan.start,label:'С',type:'start'});let n=0;for(const t of day.items)if(t.place)marks.push({place:t.place,label:String(++n),type:'included'});for(const x of plan.excluded)marks.push({place:x.place,label:'·',type:'excluded'});
    for(const t of day.items)if(t.kind==='travel')for(const coordinates of t.geometry){if(coordinates.length>1)mapObjects.push(new mapgl.Polyline(map,{coordinates,width:5,color:t.mode==='transit'?'#a26339':'#087f8c',zIndex:1}));}
  }else{marks=places.map((p,i)=>({place:p,label:String(i+1),type:'included'}));if(start)marks.push({place:start,label:'С',type:'start'});}
  for(const {place:p,label,type} of marks){const button=document.createElement('button');button.type='button';button.className='map-pin'+(type==='start'?' is-start':type==='excluded'?' is-excluded':'');button.textContent=label;button.setAttribute('aria-label',`${p.name}${type==='excluded'?' — не включено в маршрут':''}`);button.title=p.name;button.onclick=()=>focusPlace(p.id);mapObjects.push(new mapgl.HtmlMarker(map,{coordinates:[p.lon,p.lat],html:button,anchor:[18,18],interactive:true}));pins.set(p.id,button);}
  if(marks.length>1){const ps=marks.map(x=>x.place);map.fitBounds({southWest:[Math.min(...ps.map(p=>p.lon)),Math.min(...ps.map(p=>p.lat))],northEast:[Math.max(...ps.map(p=>p.lon)),Math.max(...ps.map(p=>p.lat))]},{padding:{top:50,bottom:50,left:40,right:40}});}else if(marks.length){map.setCenter([marks[0].place.lon,marks[0].place.lat]);map.setZoom(14);}
}
async function initMap(key){
  if(!key){$('#map-message').textContent='Для карты нужен TWOGIS_MAP_KEY в локальном .env. Поиск и планировщик доступны отдельно.';return;}
  try{
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://mapgl.2gis.com/api/js/v1';script.onload=resolve;script.onerror=reject;document.head.append(script);});
    map=new mapgl.Map('map',{center:[30.3158,59.9391],zoom:12,key,styleZoom:12});
    let loaded=false;map.on('idle',()=>{if(!loaded){loaded=true;$('#map-message')?.remove();renderMap();}});
    map.on('error',()=>{const node=$('#map-message');if(node){node.hidden=false;node.textContent='Не удалось загрузить карту. Проверьте доступ ключа к Map Tiles API.';}});
    setTimeout(()=>{if(!loaded&&$('#map-message'))$('#map-message').textContent='Карта ещё загружается. Если она не появилась, проверьте доступ к Map Tiles API и соединение.';},15000);
    let wasHidden=false;
    new ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;map.invalidateSize();if(width>0&&height>0&&wasHidden)renderMap();wasHidden=width===0||height===0;}).observe($('#map'));
  }catch{$('#map-message').textContent='Не удалось загрузить карту 2ГИС. Поиск и план остаются доступны.';}
}
async function boot(){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());form.elements.date.value=today;form.elements.date.min=today;
  let draft;try{draft=JSON.parse(localStorage.getItem('wayo-planner-v1')||'null');}catch{}
  if(draft?.settings){for(const [k,v] of Object.entries(draft.settings)){const field=form.elements.namedItem(k);if(field){if(field.type==='checkbox')field.checked=!!v;else field.value=v;}}if(form.elements.date.value<today)form.elements.date.value=today;form.elements.days.value='1';}
  renderCollection();
  try{const config=await api('/api/config');if(!config.hasApiKey){$('#global-status').hidden=false;$('#global-status').textContent='Для поиска и маршрутов добавьте TWOGIS_API_KEY в локальный .env и перезапустите сервер.';}initMap(config.mapKey);}catch(e){$('#global-status').hidden=false;$('#global-status').textContent=e.message;}
  if(draft?.ids?.length||draft?.startId){$('#global-status').hidden=false;$('#global-status').textContent='Восстанавливаем выбранные места из 2ГИС…';try{const restored=[];for(const id of (draft.ids||[]).slice(0,20)){try{restored.push((await api('/api/place?id='+encodeURIComponent(id))).place);}catch{}}places=restored;if(draft.startId)start=(await api('/api/place?id='+encodeURIComponent(draft.startId))).place;$('#global-status').hidden=restored.length===(draft.ids||[]).length;if(!$('#global-status').hidden)$('#global-status').textContent='Часть мест не удалось восстановить из 2ГИС. Попробуйте добавить их через поиск.';renderCollection();}catch(e){$('#global-status').textContent='Не удалось полностью восстановить черновик. '+e.message;}}
}
boot();
