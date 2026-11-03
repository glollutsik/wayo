import {extractCandidates,validateImageHeader} from './ocr-text.mjs';
export function setupScreenshotImport({api,addPlace,canAdd,notify}){
 const $=s=>document.querySelector(s),panel=$('#ocr-panel'),file=$('#ocr-file'),status=$('#ocr-status'),query=$('#ocr-query'),search=$('#ocr-find'),results=$('#ocr-results');
 let version=0,controller=null,readController=null,bitmap=null,previewUrl=null,canvas=null;
 const cache=new Map();
 function message(text,error=false){status.textContent=text;status.setAttribute('role',error?'alert':'status');}
 function releaseImage(){if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;$('#ocr-preview').removeAttribute('src');$('#ocr-preview').hidden=true;bitmap?.close();bitmap=null;if(canvas){canvas.width=canvas.height=0;canvas=null;}}
 function reset(){version++;controller?.abort();readController?.abort();controller=null;readController=null;releaseImage();file.value='';query.value='';results.replaceChildren();$('#ocr-candidates').replaceChildren();$('#ocr-text').textContent='';$('#ocr-text-details').open=false;$('#ocr-editor').hidden=true;$('#ocr-progress').hidden=true;search.disabled=false;cache.clear();message('');}
 function close(){reset();panel.hidden=true;$('#ocr-open').focus();}
 $('#ocr-open').addEventListener('click',()=>{if(!canAdd()){notify('В коллекции уже 20 мест. Удали место перед добавлением.');return;}panel.hidden=false;file.click();});
 $('#ocr-cancel').addEventListener('click',close);
 $('#ocr-replace').addEventListener('click',()=>file.click());
 file.addEventListener('change',async()=>{
  const chosen=file.files?.[0];if(!chosen)return;reset();const v=version;panel.hidden=false;message('Подготавливаем изображение…');
  const reading=new AbortController();readController=reading;
  try{
   validateImageHeader(chosen,new Uint8Array(await chosen.slice(0,12).arrayBuffer()));if(v!==version)return;
   const decoded=await createImageBitmap(chosen,{imageOrientation:'from-image'});if(v!==version){decoded.close();return;}bitmap=decoded;
   if(bitmap.width*bitmap.height>20_000_000)throw new Error('Изображение больше 20 мегапикселей. Выбери скриншот меньшего размера.');
   previewUrl=URL.createObjectURL(chosen);$('#ocr-preview').src=previewUrl;$('#ocr-preview').hidden=false;
   const scale=Math.min(1,2500/Math.max(bitmap.width,bitmap.height));canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();bitmap=null;
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));if(v!==version)return;if(!blob)throw new Error('Не удалось подготовить изображение.');
   message('Читаем название и адрес…');$('#ocr-progress').hidden=false;$('#ocr-progress').removeAttribute('value');
   const data=await api('/api/screenshot',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob,signal:reading.signal});if(v!==version||reading.signal.aborted)return;
   const candidates=data.places||[];const first=candidates[0];const outsideCity=first?.city&&extractCandidates(first.city).outsideCity;
   $('#ocr-text').textContent=data.recognizedText||'Читаемый текст не найден.';$('#ocr-editor').hidden=false;query.value=outsideCity?'':first?.query||'';
   for(const place of candidates){const button=document.createElement('button');button.type='button';button.className='ocr-chip';button.textContent=place.query;button.title=place.evidence;button.onclick=()=>{controller?.abort();query.value=place.query;results.replaceChildren();message('Проверь название или адрес и нажми «Найти место».');query.focus();};$('#ocr-candidates').append(button);}
   message(outsideCity?'На скриншоте указан другой город. Сейчас поиск работает по Санкт-Петербургу.':candidates.length?'Проверь название или адрес перед поиском.':'Не удалось уверенно прочитать название или адрес. Попробуй другой скриншот или введи название вручную.');query.focus();
  }catch(e){if(v===version&&!reading.signal.aborted){bitmap?.close();bitmap=null;message(e.message,true);$('#ocr-editor').hidden=false;}}
  finally{if(v===version){$('#ocr-progress').hidden=true;if(canvas){canvas.width=canvas.height=0;canvas=null;}}}
 });
 query.addEventListener('input',()=>{controller?.abort();results.replaceChildren();search.disabled=false;});
 query.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();search.click();}});
 search.addEventListener('click',async()=>{
  const q=query.value.trim();if(q.length<3||q.length>150){message('Введи от 3 до 150 символов.',true);query.focus();return;}if(search.disabled)return;
  const parsed=extractCandidates(q);if(parsed.outsideCity){message('Сейчас можно добавить только места Санкт-Петербурга.',true);return;}
  controller?.abort();const request=new AbortController();controller=request;const v=version;search.disabled=true;results.replaceChildren();message('Ищем в 2ГИС…');
  try{
   const data=cache.get(q)||await api('/api/search?q='+encodeURIComponent(q),{signal:request.signal});
   if(v!==version||request.signal.aborted)return;cache.set(q,data);
   message(data.places.length?'Выбери нужное место — проверь адрес и филиал.':'Место не найдено. Измени название или адрес и повтори поиск.');
   for(const place of data.places){const button=document.createElement('button');button.type='button';button.className='result';const span=document.createElement('span');for(const [tag,text]of [['strong',place.name],['small',place.address],['small',place.category]]){const node=document.createElement(tag);node.textContent=text;span.append(node);}const plus=document.createElement('span');plus.className='add';plus.textContent='+';plus.setAttribute('aria-hidden','true');button.append(span,plus);button.onclick=()=>{if(addPlace(place)!==false){close();notify('Место добавлено');}};results.append(button);}
  }catch(e){if(v===version&&!request.signal.aborted)message(e.message,true);}
  finally{if(v===version&&controller===request)search.disabled=false;}
 });
 window.addEventListener('pagehide',()=>{reset();});
}
