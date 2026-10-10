import type { Weather } from '../shared/world';
let cached:Weather|undefined;
const names:Record<number,string>={0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Snow',73:'Snow',75:'Snow',80:'Rain showers',81:'Rain showers',82:'Heavy showers',95:'Thunderstorm'};
export async function getWeather():Promise<Weather>{
 if(cached&&Date.now()-Date.parse(cached.retrievedAt)<300000)return cached;
 try{
  const r=await fetch('https://api.open-meteo.com/v1/forecast?latitude=41.3874&longitude=2.1686&current=temperature_2m,weather_code&timezone=Europe%2FMadrid',{signal:AbortSignal.timeout(4000)});
  if(!r.ok)throw Error('Weather unavailable');
  const data:any=await r.json();const code=Number(data.current.weather_code);
  cached={temperature:Number(data.current.temperature_2m),description:names[code]??'Weather observation',code,isRain:code>=51&&code!==71&&code!==73&&code!==75,retrievedAt:new Date().toISOString(),status:'live',timeZone:'Europe/Madrid'};
  return cached;
 }catch{
  if(cached)return {...cached,status:'stale'};
  return {temperature:null,description:'Weather unavailable',code:null,isRain:false,retrievedAt:new Date().toISOString(),status:'offline',timeZone:'Europe/Madrid'};
 }
}
