import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {config} from './lib/config.mjs';
import {searchPlaces,getPlace,AppError} from './lib/provider.mjs';
import {buildPlan} from './lib/planner.mjs';
import {readScreenshot} from './lib/gemini.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
let planning=false;
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if((req.method==='GET'||req.method==='HEAD')&&url.pathname==='/healthz')return json(res,200,{status:'ok'});
    if(req.method==='GET'&&url.pathname==='/api/config')return json(res,200,{mapKey:config.mapKey,hasApiKey:!!config.key,bounds:config.bounds});
    if(req.method==='POST'&&url.pathname==='/api/screenshot'){
      const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)throw new AppError('Недопустимый источник запроса.',403,'ORIGIN');
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),60000);
      res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      try{
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024)throw new AppError('Изображение больше 10 МБ.',413,'IMAGE');chunks.push(chunk);}
        return json(res,200,await readScreenshot(Buffer.concat(chunks),String(req.headers['content-type']||'').split(';')[0],controller.signal));
      }finally{clearTimeout(timer);controller.abort();}
    }
    if(req.method==='GET'&&url.pathname==='/api/search') {
      const q=String(url.searchParams.get('q')||'').trim();if(q.length<3||q.length>150)throw new AppError('Введите от 3 до 150 символов.',400,'INPUT');
      return json(res,200,{places:await searchPlaces(q)});
    }
    if(req.method==='GET'&&url.pathname==='/api/place') {
      const id=url.searchParams.get('id');if(!/^\d{1,30}$/.test(id||''))throw new AppError('Некорректное место.',400,'INPUT');
      return json(res,200,{place:await getPlace(id)});
    }
    if(req.method==='POST'&&url.pathname==='/api/plan') {
      const origin=req.headers.origin;
      if(origin&&new URL(origin).host!==req.headers.host)throw new AppError('Недопустимый источник запроса.',403,'ORIGIN');
      if(planning)throw new AppError('Предыдущий расчёт ещё выполняется. Подождите немного.',409,'BUSY');
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)throw new AppError('Слишком большой запрос.',413,'INPUT');}
      let body;try{body=JSON.parse(raw);}catch{throw new AppError('Некорректные параметры запроса.',400,'INPUT');}
      if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>20||!body.ids.every(x=>typeof x==='string'&&/^\d{1,30}$/.test(x))||!/^\d{1,30}$/.test(body.startId||'')||!body.settings)throw new AppError('Проверьте места и стартовую точку.',400,'INPUT');
      planning=true;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),config.timeout);
      res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      try {
        // Client supplies identifiers only; coordinates, roles and duration are trusted server data.
        const places=[];for(const id of body.ids)places.push(await getPlace(id,controller.signal));
        const start=await getPlace(body.startId,controller.signal);
        // Meal controls were removed: legacy clients must not restore old selections.
        const {lunch,dinner,coffee,dinnerDuration,...tripSettings}=body.settings;
        const plan=await buildPlan(places,start,tripSettings,{signal:controller.signal});
        return json(res,200,plan);
      }finally{controller.abort();planning=false;clearTimeout(timer);}
    }
    if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError('Метод недоступен.',405,'METHOD');
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    // Explicit allowlist prevents .env, source files and Git metadata being served.
    if(!['index.html','app.js','style.css','ocr-ui.js','ocr-text.mjs'].includes(name))throw new AppError('Страница не найдена.',404,'NOT_FOUND');
    const data=await readFile(path.join(root,name));
    res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')||name.endsWith('.mjs')?'text/javascript; charset=utf-8':name.endsWith('.wasm')?'application/wasm':name.endsWith('.gz')?'application/gzip':'text/css; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){if(!res.headersSent&&!res.destroyed)json(res,e instanceof AppError?e.status:500,{error:e instanceof AppError?e.message:'Не удалось обработать запрос. Попробуйте ещё раз.',code:e instanceof AppError?e.code:'INTERNAL'});}
});
server.listen(config.port,config.host,()=>console.log(`WAYO listening on ${config.host}:${config.port}`));
