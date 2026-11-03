import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanOcrText,extractCandidates,validateImageHeader} from '../ocr-text.mjs';
test('OCR candidates retain title, house number and adjacent address',()=>{const r=extractCandidates('12:30\nЭрмитаж\nДворцовая набережная, 38\nСанкт-Петербург\nНравится\nhttps://example.com');assert.ok(r.candidates.includes('Эрмитаж Дворцовая набережная, 38'));assert.equal(r.outsideCity,false);assert.ok(!r.cleaned.includes('Нравится'));});
test('multiple places are not combined into a fabricated title and address',()=>{const r=extractCandidates('Кафе Север\nул. Марата, 12\nРесторан Юг\nул. Ленина, 45');assert.ok(r.candidates.length<=3);assert.ok(r.candidates.every(q=>!(q.includes('Север')&&q.includes('Ленина'))));});
test('empty/noisy screenshots produce no place; brand digits and address are kept',()=>{assert.deepEqual(extractCandidates('12:30\nНравится\n123\nПоделиться').candidates,[]);assert.ok(cleanOcrText('Кафе 22\nул. Марата, 12 корпус 5').includes('Кафе 22'));assert.ok(cleanOcrText('ул. Марата, 12 корпус 5').includes('12 корпус 5'));});
test('explicit foreign city is flagged, Moscow street name is not mistaken for a city',()=>{assert.equal(extractCandidates('Кафе\nМосква\nул. Марата, 12').outsideCity,true);assert.equal(extractCandidates('Большая Московская улица, 5').outsideCity,false);assert.equal(extractCandidates('Санкт-Петербург').outsideCity,false);});
test('Palace Square remains a searchable title without a house number',()=>{assert.ok(extractCandidates('Дворцовая площадь').candidates.includes('Дворцовая площадь'));});
test('unsupported image and large image are rejected before OCR',()=>{assert.throws(()=>validateImageHeader({size:200},new Uint8Array([1,2,3])),/PNG/);assert.throws(()=>validateImageHeader({size:11*1024*1024},new Uint8Array([255,216,255])),/10 МБ/);assert.doesNotThrow(()=>validateImageHeader({size:100},new Uint8Array([255,216,255])));});
test('place phrase wins over garbage and dessert labels from a photographic screenshot',()=>{
 const text='т SR\nГ y\n» AW\nES Ven ea ame K\nПирожное Лимонное\nтам очень все вкусно и\nT магазин елисеевых\nкупцовых /\nкрасиво';
 const r=extractCandidates(text);assert.deepEqual(r.candidates,['магазин елисеевых']);assert.ok(!r.candidates.includes('т SR'));assert.ok(!r.candidates.includes('Г y'));
});
test('punctuation and isolated letters are not proposed as place names',()=>{assert.deepEqual(extractCandidates('« =? { i.\nр: 4 i fo\nШ y SN “oa /® ” M').candidates,[]);});
