// 独立旁白：自动选声必须属于一个有受众审查的工程。
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {findProject,selectionForProject,synthesizeNarration} from './narration.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try {
 const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
 if(cfg.tts.engine!=='volc')throw Error('TTS_ENGINE_NOT_VOLC');
 const [input,output,project]=process.argv.slice(2);if(!input||!output)throw Error('USAGE: INPUT.txt OUTPUT.wav [PROJECT]');
 const out=path.resolve(output),text=fs.readFileSync(path.resolve(input),'utf8');
 if(cfg.tts.voicePolicy?.enabled===true){
  const selected=selectionForProject(project?path.resolve(project):findProject(out));
  const result=await synthesizeNarration(text,out,selected);console.log(JSON.stringify({voice:selected.voiceName,duration:result.duration,words:result.words.length}));
 } else {
  const envFile=path.join(root,'.env');if(fs.existsSync(envFile))process.loadEnvFile(envFile);
  process.env.VOLC_TTS_RESOURCE_ID=cfg.tts.resourceId||'seed-tts-2.0';process.env.VOLC_TTS_SPEED=String(Math.round((cfg.tts.speed-1)*100));
  const {synthesize}=await import('../skills/whiteboard-video/lib/tts/volc-http.mjs');
  const result=await synthesize(text,out,{voice:cfg.tts.voice||process.env.VOLC_TTS_VOICE});fs.writeFileSync(out+'.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({duration:result.duration,words:result.words.length}));
 }
}catch(error){console.error(/^TTS_|^NARRATOR_|^AUDIENCE_|^VOICE_|^USAGE:/.test(error.message)?error.message:'NARRATION_INPUT_OR_RUNTIME_ERROR');process.exitCode=1;}
