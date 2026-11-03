import {searchPlaces,route} from '../lib/provider.mjs';
const a={lon:30.3158,lat:59.9391}, b={lon:30.3351,lat:59.9343};
try {const places=await searchPlaces('Эрмитаж');console.log(JSON.stringify({service:'search',ok:true,count:places.length,places:places.slice(0,2).map(p=>({name:p.name,category:p.category}))}));} catch(e){console.log(JSON.stringify({service:'search',ok:false,message:e.message}));}
for(const mode of ['walking','driving','transit']) {try {const r=await route(a,b,mode,Date.now()+3600000); console.log(JSON.stringify({service:mode,ok:!!r,duration:r?.duration,geometry:r?.geometry.length}));}catch(e){console.log(JSON.stringify({service:mode,ok:false,message:e.message}));}}
