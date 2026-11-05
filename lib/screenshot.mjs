import {config} from './config.mjs';
import {AppError} from './provider.mjs';
import {validateImageHeader} from '../ocr-text.mjs';
import {readScreenshot as readGemini,instruction,normalizeExtraction,upstreamDiagnostic} from './gemini.mjs';

export async function readScreenshot(image,mimeType,signal){
 const provider=config.screenshotProvider==='auto'?(config.openrouterKey?'openrouter':config.groqKey?'groq':'gemini'):config.screenshotProvider;
 if(provider==='gemini')return readGemini(image,mimeType,signal);
 if(!['groq','openrouter'].includes(provider))throw new AppError('Проверь SCREENSHOT_PROVIDER: openrouter, groq, gemini или auto.',503,'OCR_CONFIG');
 return readChat(image,mimeType,signal,provider);
}

export async function readGroq(image,mimeType,signal){return readChat(image,mimeType,signal,'groq');}
async function readChat(image,mimeType,signal,provider){
 const router=provider==='openrouter',key=router?config.openrouterKey:config.groqKey,model=router?config.openrouterModel:config.groqModel,name=router?'OpenRouter':'Groq';
 if(!key)throw new AppError('Не настроен ключ сервиса распознавания.',503,'OCR_NO_KEY');
 if(!/^[a-zA-Z0-9._/:-]+$/.test(model))throw new AppError('Проверь модель распознавания.',503,'OCR_CONFIG');
 if(router&&model!=='openrouter/free'&&!model.endsWith(':free'))throw new AppError('Для OpenRouter разрешены только бесплатные модели (:free или openrouter/free).',503,'OCR_CONFIG');
 if(!['image/png','image/jpeg','image/webp'].includes(mimeType))throw new AppError('Поддерживаются PNG, JPEG и WebP.',400,'IMAGE');
 try{validateImageHeader({size:image.length},image.subarray(0,12));}catch(e){throw new AppError(e.message,400,'IMAGE');}
 const actual=image[0]===137?'image/png':image[0]===255?'image/jpeg':'image/webp';
 if(actual!==mimeType)throw new AppError('Формат изображения не совпадает с его содержимым.',400,'IMAGE');
 try{
  const response=await fetch(router?'https://openrouter.ai/api/v1/chat/completions':'https://api.groq.com/openai/v1/chat/completions',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
   signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000),
   body:JSON.stringify({model,temperature:0,...(router?{max_tokens:4096,reasoning:{effort:'none'},provider:{max_price:{prompt:0,completion:0}}}:{max_completion_tokens:4096}),response_format:{type:'json_object'},messages:[
    {role:'system',content:instruction+' JSON structure: {"recognizedText":"", "places":[{"name":"", "address":"", "city":"", "evidence":""}]}.'},
    {role:'user',content:[{type:'text',text:'Extract readable place names and addresses. Return JSON.'},{type:'image_url',image_url:{url:`data:${mimeType};base64,${image.toString('base64')}`}}]}
   ]})
  });
  if(!response.ok){
   let body;try{body=await response.json();}catch{}
   console.warn(`[WAYO ${name}]`,JSON.stringify(upstreamDiagnostic(response.status,body,model,key)));
   if(response.status===429)throw new AppError(`Достигнут лимит распознавания ${name}. Повтори позже.`,429,'OCR_QUOTA');
   if([401,403].includes(response.status))throw new AppError(`${name} отклонил доступ. Проверь ключ и доступ к модели.`,502,'OCR_ACCESS');
   if(response.status===404)throw new AppError(`Модель ${name} недоступна. Проверь настройку модели.`,502,'OCR_MODEL');
   throw new AppError(`Сервис распознавания вернул ошибку (HTTP ${response.status}). Повтори позже или введи название вручную.`,502,'OCR_UPSTREAM');
  }
  const data=await response.json(),choice=data.choices?.[0];
  if(choice?.finish_reason!=='stop'||typeof choice.message?.content!=='string')throw new AppError('Распознавание не завершено. Попробуй другой скриншот или введи название вручную.',502,'OCR_INCOMPLETE');
  try{return normalizeExtraction(JSON.parse(choice.message.content));}
  catch{throw new AppError('Не удалось разобрать результат распознавания. Введи название вручную.',502,'OCR_FORMAT');}
 }catch(e){if(e instanceof AppError)throw e;throw new AppError('Не удалось связаться с сервисом распознавания или истекло время ожидания.',504,'OCR_NETWORK');}
}
