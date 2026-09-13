// Explicit live integration check: synthetic audio only; never opens the user's mic.
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { loadEnvFile } from 'node:process';
import { createHmac, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { readFile } from 'node:fs/promises';
const component = process.argv.includes('--component');
const production = process.argv.includes('--production');
const base = production ? 'https://atelier-architecture-studio.z3e0.chatgpt.site' : 'http://127.0.0.1:3000';
const owner = 'sites:live-flow-check-' + randomUUID();
let secret;
if (production) {
  loadEnvFile('worker/.dev.vars.local');
  secret = createHmac('sha256',Buffer.from(JSON.parse(process.env.KEY_ENCRYPTION_KEYS).v1,'base64')).update('atelier-sites-proxy-v1').digest('base64url');
}
async function api(url,init={}) {
  if (!production) return fetch(url,init);
  const token = await new SignJWT({}).setProtectedHeader({alg:'HS256'}).setSubject(owner).setIssuer('atelier-sites').setAudience('atelier-api').setIssuedAt(Math.floor(Date.now()/1000)-5).setExpirationTime('90s').sign(new TextEncoder().encode(secret));
  const originalHeaders = new Headers(init.headers), headers = new Headers();
  for (const name of ['content-type','x-atelier-agent','x-atelier-element','x-atelier-location','last-event-id']) if(originalHeaders.has(name))headers.set(name,originalHeaders.get(name));
  headers.set('Authorization','Bearer '+token);
  headers.delete('host'); headers.delete('content-length');
  return fetch(url.replace(base+'/api/studio','https://atelier-api-production.ultraraptor.workers.dev'),{...init,headers});
}
const response = await api(base + '/api/studio/projects', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Live flow verification',brief:{request:'A tiny one-storey cabin for one person, with a living and sleeping space, a bathroom, and a red exterior. Use sensible defaults and keep geometry simple.',summary:'Tiny red cabin',goals:[],constraints:[],questions:[]}})});
const project = await response.json();
if (!response.ok) throw new Error(JSON.stringify(project));
console.log(JSON.stringify({projectId:project.id}));
const browser = await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader']});
const page = await browser.newPage();
if (production) await page.route(base+'/api/studio/**',async route=>{
  const request=route.request();
  const r=await api(request.url(),{method:request.method(),headers:request.headers(),body:request.postDataBuffer()||undefined});
  console.log('PROXY_CHECK '+request.method()+' '+new URL(request.url()).pathname+' '+r.status);
  const headers=Object.fromEntries(r.headers);delete headers['content-encoding'];delete headers['content-length'];
  await route.fulfill({status:r.status,headers,body:Buffer.from(await r.arrayBuffer())});
});
page.on('console', message => { if(message.text().startsWith('VOICE_CHECK'))console.log(new Date().toISOString()+' '+message.text()); });
page.on('pageerror',error=>console.log('PAGE_ERROR '+error.message));
page.on('response',async r=>{if(r.url().includes('/voice')&&r.status()>=400)console.log('VOICE_HTTP '+r.status()+' '+await r.text());});
await page.addInitScript(id => {
  localStorage.setItem('atelier-last-project',id);
  const Original = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Original {
    constructor(...args){super(...args);window.checkPeer=this;this.addEventListener('connectionstatechange',()=>console.log('VOICE_CHECK connection '+this.connectionState));}
    createDataChannel(...args){const channel=super.createDataChannel(...args);window.checkChannel=channel;channel.addEventListener('message',event=>{try{const d=JSON.parse(event.data);if(['error','session.started','session.closed'].includes(d.type))console.log('VOICE_CHECK '+JSON.stringify({type:d.type,reason:d.reason,error:d.error,sessionId:d.session?.id}));}catch{}});channel.addEventListener('close',()=>console.log('VOICE_CHECK channel closed'));return channel;}
  };
  const audio = new AudioContext(), destination=audio.createMediaStreamDestination();
  window.checkMic=destination.stream;window.checkMicRequests=0;
  navigator.mediaDevices.getUserMedia = async () => { window.checkMicRequests++;await audio.resume(); return destination.stream; };
  window.playCheckAudio = async bytes => {const buffer=await audio.decodeAudioData(new Uint8Array(bytes).buffer);const source=audio.createBufferSource();source.buffer=buffer;source.connect(destination);source.start();};
},project.id);
try {
  await page.goto(base+'/api/studio/capabilities', {waitUntil:'domcontentloaded',timeout:15000});
  if (component) {
    await page.evaluate(()=>{document.body.innerHTML='<div id="root"></div>';});
    const componentBundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Voice from './components/Voice';window.checkRoot=createRoot(document.getElementById('root'));window.renderVoice=(agent='principal',meeting=true,inRange=true)=>window.checkRoot.render(<Voice projectId="${project.id}" agent={agent} meeting={meeting} inRange={inRange} onTranscript={t=>console.log('VOICE_CHECK transcript '+t)} onError={e=>console.log('VOICE_CHECK error '+e)}/>);window.renderVoice();`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
    await page.addScriptTag({content:componentBundle.outputFiles[0].text});
    await page.getByRole('button',{name:'Live voice',exact:true}).click();
    await page.waitForFunction(()=>document.body.textContent.includes('Mic live'),{},{timeout:65000});
    await page.waitForTimeout(20000);
    await page.evaluate(()=>window.renderVoice('architect',false,true));
    await page.waitForTimeout(3000);
    console.log('HANDOFF_CHECK '+await page.locator('body').innerText());
    await page.evaluate(()=>window.checkChannel.close());
    await page.waitForFunction(()=>document.body.textContent.includes('Mic live'),{},{timeout:65000});
    await page.waitForTimeout(5000);
    console.log('RECONNECT_CHECK '+JSON.stringify(await page.evaluate(()=>({requests:window.checkMicRequests,mic:window.checkMic.getTracks()[0].readyState,text:document.body.innerText}))));
    await page.evaluate(()=>window.renderVoice('architect',false,false));
    await page.waitForTimeout(1000);
    console.log('CORRIDOR_CHECK '+await page.locator('body').innerText());
    await page.getByRole('button',{name:'End live microphone connection',exact:true}).click();
    await page.waitForTimeout(3000);
    console.log('STOP_CHECK '+JSON.stringify(await page.evaluate(()=>({requests:window.checkMicRequests,mic:window.checkMic.getTracks()[0].readyState,text:document.body.innerText}))));
  } else {
  const bundle=await build({entryPoints:['lib/live-voice.ts'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'AtelierVoice'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(id=>{window.checkCall=new AtelierVoice.LiveVoiceSession({projectId:id,agent:'principal',agentName:'Alex',meeting:true,elementId:null,onStatus:s=>(window.checkStatus=s,console.log('VOICE_CHECK status '+s)),onTranscript:t=>console.log('VOICE_CHECK transcript '+t),onError:e=>console.log('VOICE_CHECK error '+e)});void window.checkCall.start();},project.id);
  await page.waitForFunction(()=>window.checkStatus === 'live',{},{timeout:65000});
  await page.waitForTimeout(3000);
  if(process.argv[2] && !process.argv[2].startsWith('--'))await page.evaluate(bytes=>window.playCheckAudio(bytes),Array.from(await readFile(process.argv[2])));
  for(let i=0;i<36;i++){await page.waitForTimeout(10000);const r=await api(base+'/api/studio/projects/'+project.id);const s=await r.json();console.log(JSON.stringify({tick:i,revision:s.project?.revision,runs:s.runs?.slice(0,2),recent:s.events?.slice(-3).map(e=>({type:e.type,message:e.message}))}));}
}
} finally {await page.evaluate(()=>window.checkCall?.stop()).catch(()=>{});await browser.close();}
