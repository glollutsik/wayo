import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {RoutingStore} from '../lib/routing-store.mjs';
async function isolated(fn){const dir=await mkdtemp(tmpdir()+'/wayo-routing-test-');try{await fn(pathToFileURL(dir+'/routes.json'));}finally{await rm(dir,{recursive:true,force:true});}}
test('directed route cache persists, expires and does not merge transit departures',()=>isolated(async file=>{
 let now=Date.parse('2027-01-10T10:00:00Z');const clock=()=>now;let store=new RoutingStore(file,clock);
 const a={lat:59.9,lon:30.3},b={lat:59.91,lon:30.31};const key=store.routeKey('key',a,b,'walking',now);
 await store.put(key,{duration:600,geometry:[]},'walking');store=new RoutingStore(file,clock);assert.equal((await store.get(key)).duration,600);
 assert.equal(await store.get(store.routeKey('key',b,a,'walking',now)),undefined);
 assert.notEqual(store.routeKey('key',a,b,'transit',now),store.routeKey('key',a,b,'transit',now+60000));
 now+=86400001;assert.equal(await store.get(key),undefined);
}));
