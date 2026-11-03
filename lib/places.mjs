const visit=(category,duration,source='rubric')=>({category,kind:'visit',roles:[],duration,approximate:source==='fallback',classificationSource:source});
const food=(category,roles)=>({category,kind:'food',roles,duration:15,approximate:false,classificationSource:'rubric'});
function fromRubrics(rubrics) {
  const names=rubrics.map(r=>String(r.name||'').toLowerCase());
  const has=re=>names.some(n=>re.test(n));
  // Specific place types take precedence over ancillary services (museum cafe, delivery).
  if(has(/музе/))return visit('Музей',120);
  if(has(/галере|выставоч|выставки/))return visit('Галерея и выставки',60);
  if(has(/ресторан/))return food('Ресторан',['lunch','dinner']);
  if(has(/^кафе$|столов|бистро/))return food('Кафе',['coffee','lunch','dinner']);
  if(has(/быстрое питание|пиццери|суши-бар/))return food('Быстрое питание',['lunch','dinner']);
  if(has(/кофейн|кофе с собой|кофе-бар/))return food('Кофейня',['coffee']);
  if(has(/пекарн|кондитерск/))return food('Пекарня и кондитерская',['coffee']);
  if(has(/^бары$|пабы/))return food('Бар',['dinner']);
  if(has(/памятник|монумент|скульптур/))return visit('Памятник',15);
  if(has(/смотров/))return visit('Смотровая площадка',30);
  if(has(/площад|дворик|дворы/))return visit('Городская точка',30);
  if(has(/набережн/))return visit('Набережная',60);
  if(has(/парк|ботаническ|сады|сквер/))return visit('Парк и сад',60);
  if(has(/культурно-досугов|общественн.*пространств|креативн.*пространств/))return visit('Культурное пространство',60);
  if(has(/достопримечатель|интересные здания|архитектур/))return visit('Достопримечательность',30);
  return null;
}
export function classify(item) {
  const rubrics=Array.isArray(item.rubrics)?item.rubrics:[];
  const primary=rubrics.filter(r=>r.kind==='primary');
  const result=fromRubrics(primary)||fromRubrics(rubrics);
  if(result)return result;
  // Some real sights are returned as branches with no rubrics at all.
  const name=String(item.name||'').toLowerCase();
  for(const [re,category,duration] of [
    [/музей/,'Музей',120],[/галерея|выставка/,'Галерея и выставки',60],
    [/смотровая/,'Смотровая площадка',30],[/площадь|дворик|дворы/,'Городская точка',30],
    [/памятник|монумент/,'Памятник',15],[/набережная/,'Набережная',60],
    [/ботанический сад|летний сад|парк|сквер/,'Парк и сад',60],
    [/культурно-развлекательное пространство|общественное пространство/,'Культурное пространство',60],
  ])if(re.test(name))return visit(category,duration,'name');
  // A provider-supplied type suffix is safer than guessing from the brand name.
  const suffix=name.split(',').slice(1).join(',').trim();
  if(suffix){const f=fromRubrics([{name:suffix}]);if(f)return {...f,classificationSource:'name'};}
  return visit('Категория не определена',60,'fallback');
}
export function normalizePlace(item) {
  return {id:String(item.id),provider:'2gis',name:item.name,address:item.full_address_name||item.address_name||'Санкт-Петербург',lon:item.point?.lon,lat:item.point?.lat,...classify(item),source:'search'};
}
