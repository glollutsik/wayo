import test from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../lib/config.mjs';
import {readScreenshot} from '../lib/screenshot.mjs';
const image=Buffer.from([255,216,255,0]);
async function mocked(fetch,work){
 const previous={fetch:globalThis.fetch,key:config.groqKey,model:config.groqModel,provider:config.screenshotProvider,warn:console.warn,routerKey:config.openrouterKey,routerModel:config.openrouterModel};
 config.openrouterKey='';config.groqKey='gsk_test_secret';config.groqModel='qwen/qwen3.8-27b';config.screenshotProvider='auto';globalThis.fetch=fetch;console.warn=()=>{};
 try{await work();}finally{globalThis.fetch=previous.fetch;config.groqKey=previous.key;config.groqModel=previous.model;config.screenshotProvider=previous.provider;console.warn=previous.warn;config.openrouterKey=previous.routerKey;config.openrouterModel=previous.routerModel;}
}
const response=(content,finish_reason='stop')=>Response.json({choices:[{finish_reason,message:{content:JSON.stringify(content)}}]});
test('Groq receives one image request with private header and returns normalized places',()=>mocked(async(url,options)=>{
 assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer gsk_test_secret');
 const body=JSON.parse(options.body);assert.equal(body.model,config.groqModel);assert.equal(body.response_format.type,'json_object');assert.equal(body.messages[1].content[1].image_url.url,`data:image/jpeg;base64,${image.toString('base64')}`);
 return response({recognizedText:'Музей',places:[{name:'Музей',address:'',city:'',evidence:'Музей'}]});
},async()=>{const result=await readScreenshot(image,'image/jpeg');assert.equal(result.places[0].query,'Музей');assert.ok(!JSON.stringify(result).includes('gsk_'));}));
test('Groq errors are safe and do not retry or fall back to Gemini',async()=>{
 for(const [status,code]of [[401,'OCR_ACCESS'],[403,'OCR_ACCESS'],[404,'OCR_MODEL'],[429,'OCR_QUOTA'],[503,'OCR_UPSTREAM']]){
  let calls=0;await mocked(async()=>{calls++;return Response.json({error:{message:'private gsk_test_secret'}},{status});},async()=>{
   await assert.rejects(readScreenshot(image,'image/jpeg'),e=>e.code===code&&!e.message.includes('private')&&!e.message.includes('gsk_'));assert.equal(calls,1);
  });
 }
});
test('invalid images never reach Groq',()=>mocked(async()=>{throw Error('must not fetch');},async()=>{
 await assert.rejects(readScreenshot(Buffer.from('invalid'),'image/jpeg'),e=>e.code==='IMAGE');
 await assert.rejects(readScreenshot(image,'image/png'),e=>e.code==='IMAGE');
}));
test('partial and malformed responses cannot produce place guesses',async()=>{
 await mocked(async()=>response({recognizedText:'x',places:[]},'length'),async()=>{await assert.rejects(readScreenshot(image,'image/jpeg'),e=>e.code==='OCR_INCOMPLETE');});
 await mocked(async()=>response({places:'wrong'}),async()=>{await assert.rejects(readScreenshot(image,'image/jpeg'),e=>e.code==='OCR_FORMAT');});
});
test('empty recognition returns an empty collection',()=>mocked(async()=>response({recognizedText:'',places:[]}),async()=>{
 assert.deepEqual(await readScreenshot(image,'image/jpeg'),{recognizedText:'',places:[]});
}));

test('OpenRouter uses the free router, zero pricing ceiling and private authorization',()=>mocked(async(url,options)=>{
 assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer sk-or-test');
 const body=JSON.parse(options.body);assert.equal(body.model,'openrouter/free');assert.deepEqual(body.provider.max_price,{prompt:0,completion:0});assert.equal(body.max_tokens,4096);assert.deepEqual(body.reasoning,{effort:'none'});
 return response({recognizedText:'',places:[]});
},async()=>{config.openrouterKey='sk-or-test';config.openrouterModel='openrouter/free';await readScreenshot(image,'image/jpeg');}));
test('OpenRouter rejects paid models before sending any request',()=>mocked(async()=>{throw Error('must not fetch');},async()=>{
 config.openrouterKey='sk-or-test';config.openrouterModel='paid/model';await assert.rejects(readScreenshot(image,'image/jpeg'),e=>e.code==='OCR_CONFIG');
}));
