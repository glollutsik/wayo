import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Persistent route cache. Neither API keys nor full request URLs are stored.
export class RoutingStore{
  constructor(file=new URL('../data/2gis-routing.json',import.meta.url),clock=Date.now){this.file=file;this.clock=clock;this.state={routes:{}};this.queue=Promise.resolve();this.loaded=null;}
  async load(){this.loaded??=(async()=>{try{const data=JSON.parse(await readFile(this.file,'utf8'));if(data.routes)this.state={routes:data.routes};}catch(e){if(e.code!=='ENOENT')throw new Error('Не удалось прочитать кеш маршрутов.');}})();await this.loaded;}
  async transaction(fn){const task=this.queue.then(async()=>{await this.load();const result=fn();await mkdir(new URL('./',this.file),{recursive:true,mode:0o700});const tmp=new URL(this.file.href+'.tmp');await writeFile(tmp,JSON.stringify(this.state),{mode:0o600});await rename(tmp,this.file);return result;});this.queue=task.catch(()=>{});return task;}
  scope(key){return createHash('sha256').update(key).digest('hex').slice(0,20);}
  routeKey(key,a,b,mode,departure){return [this.scope(key),a.lon,a.lat,b.lon,b.lat,mode,mode==='transit'?Math.floor(departure/60000):'static'].join(':');}
  async get(key){await this.load();const entry=this.state.routes[key];return entry?.expires>this.clock()?entry.route:undefined;}
  async put(key,route,mode){return this.transaction(()=>{const ttl=mode==='walking'?86400000:mode==='driving'?300000:900000;this.state.routes[key]={route,expires:this.clock()+ttl};for(const [k,v]of Object.entries(this.state.routes))if(v.expires<=this.clock())delete this.state.routes[k];const keys=Object.keys(this.state.routes);for(const k of keys.slice(0,Math.max(0,keys.length-1000)))delete this.state.routes[k];});}
}
export const routingStore=new RoutingStore();
