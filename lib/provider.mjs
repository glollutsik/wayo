import {setTimeout as delay} from 'node:timers/promises';
import {config, inBounds} from './config.mjs';
import {normalizePlace} from './places.mjs';
import {routingStore} from './routing-store.mjs';
export class AppError extends Error { constructor(message, status=502, code='PROVIDER') {super(message); this.status=status; this.code=code;} }
export async function decodeResponse(response, isRouting=false) {
  const status=response.status;
  if(status===204)return null;
  // Access and quota failures may have an HTML or empty body rather than JSON.
  if([401,403].includes(status))throw new AppError('Ключ 2ГИС не даёт доступа к этому сервису. Проверьте разрешения и ограничения ключа в кабинете 2ГИС.',502,'ACCESS');
  if(status===429){
    const header=response.headers?.get('retry-after');
    const wait=header&&/^\d+(?:\.\d+)?$/.test(header)?Number(header)*1000:null;
    if(wait!==null&&wait<=5000){const e=new AppError('2ГИС ограничил частоту запросов. Подождите немного и повторите расчёт.',429,'RATE_LIMIT');e.retryAfter=Math.max(500,wait);throw e;}
    throw new AppError('2ГИС ограничил запросы (HTTP 429). Проверьте остаток квоты и ограничения частоты в кабинете 2ГИС.',429,'QUOTA');
  }
  if([404,422].includes(status)&&isRouting)return null;
  if(status>=500)throw new AppError(`Сервис 2ГИС временно недоступен (HTTP ${status}). Повторите расчёт.`,502,'UPSTREAM');
  let text;
  try{text=await response.text();}catch{throw new AppError('Соединение с 2ГИС прервалось при получении ответа. Повторите расчёт.',504,'NETWORK');}
  let data;
  try{data=JSON.parse(text);}catch{throw new AppError(`2ГИС вернул ${text.trim()?'ответ в неожиданном формате':'пустой ответ'} (HTTP ${status}). Повторите запрос.`,502,'FORMAT');}
  const code=Number(data?.meta?.code||status);
  if(!response.ok||code>=400) {
    if([401,403].includes(code))throw new AppError('Ключ 2ГИС не даёт доступа к этому сервису. Проверьте разрешения и ограничения ключа в кабинете 2ГИС.',502,'ACCESS');
    if(code===429)throw new AppError('Лимит запросов 2ГИС исчерпан. Повторите позже.',429,'QUOTA');
    if([404,422].includes(code)&&isRouting)return null;
    throw new AppError(`2ГИС отклонил запрос (код ${code}).`,502,'PROVIDER');
  }
  return data;
}
async function request(url, body, signal) {
  if(!config.key)throw new AppError('Добавьте ключ 2ГИС в локальный .env и перезапустите приложение.',503,'NO_KEY');
  for(let attempt=0;attempt<(body?1:3);attempt++) {
    let response;
    try {
      response=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
      return await decodeResponse(response,!!body);
    }catch(error){
      const e=error instanceof AppError?error:new AppError('2ГИС не ответил вовремя. Попробуйте ещё раз.',504,'NETWORK');
      const retryable=['NETWORK','FORMAT','UPSTREAM','RATE_LIMIT'].includes(e.code);
      if(!body&&attempt<2&&retryable&&!signal?.aborted){
        try{await delay(e.retryAfter??(attempt===0?400:1200),undefined,{signal});}catch{throw e;}
        continue;
      }
      // Diagnostic metadata only; never log URLs, headers, keys or provider bodies.
      console.warn('2GIS request failed:',JSON.stringify({service:url.pathname,status:response?.status,code:e.code}));
      throw e;
    }
  }
}
const placeCache=new Map();
function keepPlace(p){placeCache.delete(p.id);placeCache.set(p.id,{place:p,expires:Date.now()+1800000});while(placeCache.size>500)placeCache.delete(placeCache.keys().next().value);return p;}
export async function searchPlaces(q, signal) {
  const url = new URL('https://catalog.api.2gis.com/3.0/items');
  for (const [k,v] of Object.entries({key:config.key,q,location:'30.3158,59.9391',radius:45000,page_size:10,fields:'items.point,items.rubrics,items.full_address_name'})) url.searchParams.set(k,v);
  const data = await request(url, undefined, signal);
  return (data?.result?.items || []).map(normalizePlace).filter(inBounds).map(keepPlace);
}
export async function getPlace(id, signal) {
  const cached=placeCache.get(id);if(cached?.expires>Date.now())return cached.place;
  const url = new URL('https://catalog.api.2gis.com/3.0/items/byid');
  for (const [k,v] of Object.entries({key:config.key,id,fields:'items.point,items.rubrics,items.full_address_name'})) url.searchParams.set(k,v);
  const data = await request(url, undefined, signal);
  const p = data?.result?.items?.[0];
  if (!p || !inBounds(p.point)) throw new AppError('Место не найдено внутри поддерживаемой территории.',400,'PLACE');
  return keepPlace(normalizePlace(p));
}
export function parseLine(wkt) {
  const match = typeof wkt === 'string' && wkt.match(/^LINESTRING(?:\s+Z)?\s*\((.+)\)$/i);
  if (!match) return [];
  return match[1].split(',').map(x=>x.trim().split(/\s+/).slice(0,2).map(Number)).filter(p=>p.length===2&&p.every(Number.isFinite));
}
function geometry(route) {
  const lines=[];
  // Only the selected alternative of each movement; alternative geometries must not overlap.
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.selection === 'string') { const line=parseLine(value.selection); if(line.length>1) lines.push(line); }
    if (Array.isArray(value)) { value.forEach(collect); return; }
    for(const [key,child] of Object.entries(value)) {
      if(key==='selection') continue;
      if(key==='alternatives') { if(child?.[0]) collect(child[0]); }
      else collect(child);
    }
  };
  collect(route.maneuvers || route.movements || route.geometry);
  return lines;
}
export function normalizeRoute(route, mode) {
  if (!Number.isFinite(route?.total_duration) || route.total_duration < 0) return null;
  const lines=[...new Set((route.waypoints||[]).flatMap(w=>w.routes_names || []))];
  return {mode:route.pedestrian?'walking':mode,duration:route.total_duration,distance:route.total_distance||0,transfers:(route.transfer_count||0)+(route.crossing_count||0),lines,geometry:geometry(route),estimated:true};
}
async function requestRoute(a,b,mode,departure,signal) {
  if (a.lon===b.lon && a.lat===b.lat) return {mode:mode==='driving'?'driving':'walking',duration:0,distance:0,transfers:0,lines:[],geometry:[],estimated:true};
  const transit=mode==='transit';
  const url=new URL(transit?'https://routing.api.2gis.com/public_transport/2.0':'https://routing.api.2gis.com/routing/7.0.0/global');
  url.searchParams.set('key',config.key);
  const point=p=>({lon:p.lon,lat:p.lat});
  const body=transit?{source:{point:point(a)},target:{point:point(b)},transport:['pedestrian','metro','bus','tram','trolleybus','suburban_train'],start_time:Math.floor(departure/1000),enable_schedule:true,max_result_count:3,locale:'ru'}:{points:[{...point(a),type:'stop'},{...point(b),type:'stop'}],transport:mode==='walking'?'walking':'driving',route_mode:'fastest',output:'detailed',...(mode==='driving'?{traffic_mode:'jam'}:{}),locale:'ru'};
  let data;
  try{data=await request(url,body,signal);}catch(e){console.warn('2GIS route endpoints:',JSON.stringify({from:a.id,to:b.id,mode,code:e.code}));throw e;}
  const options=(Array.isArray(data)?data:data?.result || []).map(r=>normalizeRoute(r,mode)).filter(Boolean).sort((x,y)=>x.duration-y.duration||x.transfers-y.transfers);
  return options[0] || null;
}

export async function route(a,b,mode,departure,signal){
  if(process.env.NODE_ENV==='test')return requestRoute(a,b,mode,departure,signal);
  const key=routingStore.routeKey(config.key,a,b,mode,departure);
  const cached=await routingStore.get(key);
  if(cached!==undefined)return cached===null?null:{...cached,cacheHit:true};
  const result=await requestRoute(a,b,mode,departure,signal);
  if(result)await routingStore.put(key,result,mode);
  return result;
}
