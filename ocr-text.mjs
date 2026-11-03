const noise=/^(?:\d{1,2}:\d{2}|[\d\s.,]+[кkmм]?(?:\s*(?:лайк\S*|просмотр\S*|подписчик\S*))?|нравится|поделиться|подписаться|сохранить|комментарии|рекомендации|для вас|читать далее|смотри(?:те)? описание|сохрани(?:те)? на будущее)$/iu;
const address=/(?:\b(?:street|avenue|road)\b|(?:^|\s)(?:ул\.?|улица|проспект|пр-т|пр\.|набережная|наб\.|переулок|пер\.|площадь|пл\.)[.,]?\s)/iu;
const cities=/(?<![\p{L}])(?:moscow|london|paris|москва|москве|москвы|казань|казани|сочи|екатеринбург|новосибирск|нижний новгород|калининград|париж|лондон|стамбул|санкт-петербург|петербург|спб)(?![\p{L}])/iu;
export function cleanOcrText(text){return String(text||'').split(/\r?\n/).map(line=>line.replace(/https?:\/\/\S+|www\.\S+|@[\p{L}\d_.]+/gu,' ').replace(/\+?\d[\d ()-]{8,}\d/g,' ').replace(/[|¦]/g,' ').replace(/\s+/g,' ').trim()).filter(line=>line&&!noise.test(line)&&/[\p{L}]/u.test(line)).join('\n');}
export function extractCandidates(text){
 const lines=cleanOcrText(text).split('\n').filter(Boolean);const cityLine=lines.find(l=>cities.test(l));
 const city=cityLine?.match(cities)?.[0]||null;
 const outsideCity=!!city&&!/санкт-петербург|петербург|спб/i.test(city);
 // A photograph produces many imaginary short "words". Never offer those as names.
 const readable=l=>{const letters=(l.match(/[\p{L}]/gu)||[]).length;const solid=l.replace(/\s/g,'').length;return /[\p{L}]{3}/u.test(l)&&letters/Math.max(1,solid)>=0.65;};
 const narrative=/^(?:там\s|потом\s|затем\s|очень\s|в[сёе]\s|красиво|вкусно|сохрани|подпиш|ставьте лайк|лучшие места|места которые|куда сходить|реклама|описание|телефон|адрес:?$|пирожное|пирожные|cake|raspberry|lemon)/iu;
 const useful=lines.filter(l=>l.length>=3&&l.length<=150&&readable(l)&&!narrative.test(l));
 const fullAddress=l=>address.test(l)&&/\d/.test(l);
 const addresses=useful.filter(fullAddress);
 const title=l=>!fullAddress(l)&&l!==cityLine&&l.length<=90&&!/^(?:адрес|телефон|время работы|открыто|закрыто|подпис|лайк|сохрани|смотрите|читать|комментар|отзыв)/iu.test(l);
 const titles=useful.filter(title);const result=[];
 const push=q=>{q=q.replace(/^[-•\d]+[.)]\s*/,'').trim();if(q.length>=3&&q.length<=150&&!result.some(x=>x.toLowerCase()===q.toLowerCase()))result.push(q);};
 // Join only one unambiguous title/address pair. Multiple independent places remain separate.
 if(addresses.length===1&&titles.length===1){const a=useful.indexOf(addresses[0]),t=useful.indexOf(titles[0]);if(Math.abs(a-t)===1)push(titles[0]+' '+addresses[0]);}
 // Recognizable place phrases take precedence over product labels and unrelated picture noise.
 // Use only words actually read from the screenshot; no lookup table of famous destinations.
 const placePhrase=/(?<![\p{L}])(?:магазин|музей|кафе|кофейня|ресторан(?:-бар)?|галерея|ботанический сад|парк|собор|дворец|театр|бар)(?![\p{L}])/iu;
 for(const line of titles){const match=placePhrase.exec(line);if(!match)continue;const q=line.slice(match.index).replace(/[\s/\\|«»“”]+$/g,'').trim();if(q.split(/\s+/).length>=2&&/[\p{L}]{3}/u.test(q.slice(match[0].length)))push(q);}
 for(const l of addresses)push(l);
 if(!result.length)for(const l of titles)push(l);
 return {candidates:result.slice(0,3),city,outsideCity,cleaned:lines.join('\n')};
}
export function validateImageHeader(file,bytes){
 if(file.size>10*1024*1024)throw new Error('Файл больше 10 МБ. Выбери скриншот меньшего размера.');
 const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 if(!png&&!jpeg&&!webp)throw new Error('Выбери изображение PNG, JPEG или WebP.');
}
