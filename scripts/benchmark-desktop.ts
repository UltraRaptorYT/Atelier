import { Sandbox } from '@e2b/desktop';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { exampleDesign } from '../shared/example';
import { limits } from '../shared/budget';
if (existsSync('worker/.dev.vars.local')) loadEnvFile('worker/.dev.vars.local');
if (!process.env.E2B_API_KEY) throw new Error('Set E2B_API_KEY in your local environment. Never paste it into a task or commit it.');
const started=Date.now(), report:Record<string,unknown>={startedAt:new Date().toISOString(),template:process.env.E2B_TEMPLATE||'atelier-desktop',revision:1,renderComplete:false,streamServerStarted:false};
let desktop:Sandbox|undefined;
await mkdir('.atelier/benchmark',{recursive:true});
try {
  desktop=await Sandbox.create(String(report.template),{apiKey:process.env.E2B_API_KEY,timeoutMs:900000,resolution:[1280,800]});
  report.startupSeconds=(Date.now()-started)/1000;
  await desktop.commands.run('mkdir -p /home/user/project/output');
  for(const [source,target] of [['scripts/blender_compile.py','blender_compile.py'],['shared/furniture.json','furniture.json']]) await desktop.files.write(`/home/user/project/${target}`,await readFile(source,'utf8'));
  await desktop.files.write('/home/user/project/design.json',JSON.stringify(exampleDesign(),null,2));
  const machine=await desktop.commands.run('lscpu'); report.cpu=machine.stdout;
  const memory=await desktop.commands.run('free -m');report.memory=memory.stdout;
  const blender=await desktop.commands.run('blender --version');report.blender=blender.stdout;
  await desktop.stream.start({requireAuth:true});
  report.streamServerStarted=Boolean(desktop.stream.getAuthKey()); // Interactive authenticated playback still requires a browser check.
  const renderStart=Date.now();
  const result=await desktop.commands.run('timeout 780s blender --background --python /home/user/project/blender_compile.py -- --design /home/user/project/design.json --output /home/user/project/output --render --revision 1',{timeoutMs:790000});
  report.renderSeconds=(Date.now()-renderStart)/1000;report.exitCode=result.exitCode;
  report.renderComplete=result.exitCode===0;
  for(const name of ['design.blend','design.glb','presentation.png']) {try{await writeFile(`.atelier/benchmark/${name}`,await desktop.files.read(`/home/user/project/output/${name}`,{format:'bytes'}));}catch{/* Record missing output without inventing a completed render. */}}
  await writeFile('.atelier/benchmark/desktop.png',await desktop.screenshot());
}catch(error){report.error=error instanceof Error ? error.name : 'BenchmarkError';}
finally {
  if(desktop) {try{await desktop.kill();}catch{report.shutdown='Provider timeout will end the 15-minute session.';}}
  report.totalSeconds=(Date.now()-started)/1000;report.estimatedComputeDollars=Number((Number(report.totalSeconds)*limits.costPerSecond).toFixed(4));
  await writeFile('.atelier/benchmark/report.json',JSON.stringify(report,null,2));
  console.log('Benchmark report and completed outputs: .atelier/benchmark');
  if(!report.renderComplete) process.exitCode=1;
}
