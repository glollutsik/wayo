import test from 'node:test';
import assert from 'node:assert/strict';
import {readScreenshot,normalizeExtraction,upstreamDiagnostic} from '../lib/gemini.mjs';
import {config} from '../lib/config.mjs';
const image=Buffer.from([255,216,255,0]);
const place={name:'Ботанический сад Петра Великого',address:'',city:'',evidence:'Ботанический сад Петра Великого'};
async function mocked(fn,work){const previous={fetch:globalThis.fetch,key:config.geminiKey,model:config.geminiModel};globalThis.fetch=fn;config.geminiKey='test-secret-only';config.geminiModel='gemini-3.5-flash-lite';try{await work();}finally{globalThis.fetch=previous.fetch;config.geminiKey=previous.key;config.geminiModel=previous.model;}}
const response=data=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(data)}]}}]});
test('image is sent once with server-only key, JSON schema and no search tools',()=>mocked(async(url,options)=>{
 assert.equal(new URL(url).hostname,'generativelanguage.googleapis.com');assert.ok(!url.includes('test-secret-only'));assert.equal(options.headers['x-goog-api-key'],'test-secret-only');const body=JSON.parse(options.body);assert.equal(body.contents[0].parts[1].inlineData.data,image.toString('base64'));assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.tools,undefined);return response({recognizedText:place.name,places:[place]});
},async()=>{const result=await readScreenshot(image,'image/jpeg');assert.equal(result.places[0].query,place.name);assert.equal(JSON.stringify(result).includes('test-secret-only'),false);}));
test('unreadable image produces no fabricated place',()=>mocked(async()=>response({recognizedText:'',places:[]}),async()=>{assert.deepEqual((await readScreenshot(image,'image/jpeg')).places,[]);}));
test('malformed extraction and unsupported image are rejected',async()=>{assert.throws(()=>normalizeExtraction({places:'wrong'}));await mocked(async()=>{throw new Error('must not fetch');},async()=>{await assert.rejects(readScreenshot(Buffer.from('not an image'),'image/jpeg'),e=>e.code==='IMAGE');});});
test('candidate must have textual evidence; duplicates are removed',()=>{const result=normalizeExtraction({recognizedText:'x',places:[place,place,{name:'Unknown',evidence:''}]});assert.equal(result.places.length,1);});
test('quota, region access and model errors are safe and never retried',async()=>{
 for(const [status,code]of [[429,'GEMINI_QUOTA'],[403,'GEMINI_ACCESS'],[404,'GEMINI_MODEL'],[500,'GEMINI_UPSTREAM']]){let calls=0;await mocked(async()=>{calls++;return new Response('PRIVATE PROVIDER BODY test-secret-only',{status});},async()=>{await assert.rejects(readScreenshot(image,'image/jpeg'),e=>e.code===code&&!e.message.includes('PRIVATE')&&!e.message.includes('test-secret-only'));assert.equal(calls,1);});}
});
test('truncated or blocked generation does not leak partial place guesses',()=>mocked(async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]}),async()=>{await assert.rejects(readScreenshot(image,'image/jpeg'),e=>e.code==='GEMINI_BLOCKED');}));
test('provider diagnostics exclude credentials, URLs and unrelated response fields',()=>{
 const result=upstreamDiagnostic(503,{error:{status:'UNAVAILABLE',message:'Busy test-secret-only https://example.com/?key=private',details:[{image:'PRIVATE_IMAGE'}]},private:'PRIVATE_BODY'},'gemini-test','test-secret-only');
 assert.equal(result.providerStatus,'UNAVAILABLE');assert.equal(result.httpStatus,503);
 const text=JSON.stringify(result);for(const secret of ['test-secret-only','example.com','private','PRIVATE_IMAGE','PRIVATE_BODY'])assert.ok(!text.includes(secret));
});
test('503 reports temporary unavailability, logs provider reason and makes one request',()=>mocked(async()=>Response.json({error:{status:'UNAVAILABLE',message:'Model capacity temporarily exhausted test-secret-only'}},{status:503}),async()=>{
 const previous=console.warn,logs=[];console.warn=(...args)=>logs.push(args.join(' '));
 try{await assert.rejects(readScreenshot(image,'image/jpeg'),e=>e.code==='GEMINI_UNAVAILABLE'&&!e.message.includes('capacity'));assert.equal(logs.length,1);assert.match(logs[0],/UNAVAILABLE/);assert.match(logs[0],/gemini-3.5-flash-lite/);assert.ok(!logs[0].includes('test-secret-only'));}finally{console.warn=previous;}
}));
