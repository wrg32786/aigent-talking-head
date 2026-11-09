import { chromium } from 'playwright-core';
import { mkdirSync, rmSync } from 'fs';
// Run from the job's build/ folder (holds overlay.html). node render.mjs <durationSec> [t1,t2,... for stills only]
const ROOT=process.cwd().split('\\').join('/'), FPS=24, DUR=+(process.argv[2]||36.8);
const only=process.argv[3]?process.argv[3].split(',').map(Number):null;
const b=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
await p.goto('file:///'+ROOT+'/overlay.html',{waitUntil:'networkidle'});
await p.waitForFunction(()=>window.__ready===true,null,{timeout:20000});
if((await p.evaluate(()=>window.__skool))===false){console.error('skool logo failed to load');process.exit(1)}
const dir=ROOT+(only?'/stills':'/ovl');if(!only){rmSync(dir,{recursive:true,force:true})}mkdirSync(dir,{recursive:true});
const list=only||[...Array(Math.round(DUR*FPS)).keys()].map(f=>f/FPS);
let i=0;for(const t of list){await p.evaluate(t=>window.seek(t),t);await p.screenshot({path:`${dir}/${only?('t'+t.toFixed(2)):String(i).padStart(4,'0')}.png`,omitBackground:true});i++}
console.log('frames',i);await b.close();
