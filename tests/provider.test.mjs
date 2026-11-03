import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeResponse} from '../lib/provider.mjs';
process.env.NODE_ENV='test';
test('HTML access error is explained as access restriction',async()=>{await assert.rejects(decodeResponse(new Response('<html>Forbidden</html>',{status:403})),e=>e.code==='ACCESS');});
test('HTML gateway error is retryable service failure',async()=>{await assert.rejects(decodeResponse(new Response('<html>Bad Gateway</html>',{status:502})),e=>e.code==='UPSTREAM');});
test('empty HTTP 200 is distinct from denied access',async()=>{await assert.rejects(decodeResponse(new Response('',{status:200})),e=>e.code==='FORMAT'&&e.message.includes('пустой'));});
test('invalid JSON without raw response disclosure',async()=>{const body='<html>SECRET_PROVIDER_BODY</html>';await assert.rejects(decodeResponse(new Response(body)),e=>e.code==='FORMAT'&&!e.message.includes('SECRET'));});
test('JSON access code and missing route are handled',async()=>{await assert.rejects(decodeResponse(Response.json({meta:{code:403}})),e=>e.code==='ACCESS');assert.equal(await decodeResponse(new Response('',{status:404}),true),null);});
test('normal API JSON is preserved',async()=>{const data={result:[{total_duration:300}]};assert.deepEqual(await decodeResponse(Response.json(data),true),data);});
test('interrupted response body is a network error',async()=>{await assert.rejects(decodeResponse({status:200,ok:true,text:async()=>{throw new Error('connection reset');}}),e=>e.code==='NETWORK');});
test('routing failure makes one attempt and never spends quota on automatic retries',async()=>{
  const {config}=await import('../lib/config.mjs');const {route}=await import('../lib/provider.mjs');
  const originalFetch=globalThis.fetch,originalKey=config.key;let attempts=0;
  config.key='test-only';globalThis.fetch=async()=>{attempts++;return new Response('',{status:502});};
  try{await assert.rejects(route({id:'1',lon:30.3,lat:59.9},{id:'2',lon:30.31,lat:59.91},'walking',Date.now()),e=>e.code==='UPSTREAM');assert.equal(attempts,1);}finally{globalThis.fetch=originalFetch;config.key=originalKey;}
});
test('walking payload omits invalid traffic mode that caused real HTTP 502',async()=>{
  const {config}=await import('../lib/config.mjs');const {route}=await import('../lib/provider.mjs');
  const originalFetch=globalThis.fetch,originalKey=config.key;let payload;
  config.key='test-only';globalThis.fetch=async(url,options)=>{payload=JSON.parse(options.body);return Response.json({result:[{total_duration:300,total_distance:400,maneuvers:[]}]});};
  try{await route({id:'1',lon:30.3,lat:59.9},{id:'2',lon:30.31,lat:59.91},'walking',Date.now());assert.equal(payload.transport,'walking');assert.equal(payload.output,'detailed');assert.equal('traffic_mode' in payload,false);}finally{globalThis.fetch=originalFetch;config.key=originalKey;}
});
test('short Retry-After is a rate limit while missing reset time is not blindly retried',async()=>{
  await assert.rejects(decodeResponse(new Response('',{status:429,headers:{'Retry-After':'1'}})),e=>e.code==='RATE_LIMIT'&&e.retryAfter===1000);
  await assert.rejects(decodeResponse(new Response('',{status:429})),e=>e.code==='QUOTA');
});
test('route cache avoids duplicate mocked HTTP calls without a daily counter',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {pathToFileURL}=await import('node:url');
 const {routingStore}=await import('../lib/routing-store.mjs');const {route}=await import('../lib/provider.mjs');const {config}=await import('../lib/config.mjs');
 const dir=await mkdtemp(tmpdir()+'/wayo-provider-test-');const previous={file:routingStore.file,state:routingStore.state,loaded:routingStore.loaded,queue:routingStore.queue,key:config.key,env:process.env.NODE_ENV,fetch:globalThis.fetch};let calls=0;
 try{
  routingStore.file=pathToFileURL(dir+'/routes.json');routingStore.state={routes:{}};routingStore.loaded=null;routingStore.queue=Promise.resolve();config.key='test-only';process.env.NODE_ENV='production';
  globalThis.fetch=async()=>{calls++;return Response.json({result:[{total_duration:300,total_distance:400,maneuvers:[]}]});};
  const a={id:'1',lon:30.3,lat:59.9},b={id:'2',lon:30.31,lat:59.91};
  await route(a,b,'walking',Date.now());const second=await route(a,b,'walking',Date.now());assert.equal(calls,1);assert.equal(second.cacheHit,true);assert.equal('usage' in routingStore.state,false);
 }finally{routingStore.file=previous.file;routingStore.state=previous.state;routingStore.loaded=previous.loaded;routingStore.queue=previous.queue;config.key=previous.key;process.env.NODE_ENV=previous.env;globalThis.fetch=previous.fetch;await rm(dir,{recursive:true,force:true});}
});
