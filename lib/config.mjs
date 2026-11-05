import { fileURLToPath } from 'node:url';
try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch (e) { if (e.code !== 'ENOENT') throw new Error('Не удалось загрузить локальную конфигурацию'); }
const geminiKeyName=Object.keys(process.env).find(k=>k.toUpperCase()==='GEMINI_API_KEY');
export const config = {
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
  openrouterModel: process.env.OPENROUTER_MODEL || 'openrouter/free',
  groqKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
  screenshotProvider: process.env.SCREENSHOT_PROVIDER || 'auto',
  geminiKey: process.env.GEMINI_API_KEY || (geminiKeyName?process.env[geminiKeyName]:'') || process.env.GOOGLE_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  key: process.env.TWOGIS_API_KEY || '', mapKey: process.env.TWOGIS_MAP_KEY || '',
  port: Number(process.env.PORT || 4174), host: process.env.HOST || (process.env.RENDER?'0.0.0.0':'127.0.0.1'),
  timeout: Number(process.env.PLANNING_TIMEOUT_MS || 120000),
  routingInterval: Math.max(0,Number(process.env.ROUTING_INTERVAL_MS || 300)),
  // Supported search area: Saint Petersburg and nearby neighbourhoods.
  bounds: [29.5, 59.65, 30.75, 60.15],
};
export function inBounds(p) { return Number.isFinite(p?.lon) && Number.isFinite(p?.lat) && p.lon >= config.bounds[0] && p.lon <= config.bounds[2] && p.lat >= config.bounds[1] && p.lat <= config.bounds[3]; }
