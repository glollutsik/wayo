import test from 'node:test';
import assert from 'node:assert/strict';
import {readScreenshot,normalizeExtraction} from '../lib/gemini.mjs';
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
