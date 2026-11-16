// Per-scene narration with one audience-reviewed, locked voice per episode.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import paths from './paths.cjs';
import {synthesize} from './tts/tts.mjs';
const {cfg,projectPaths}=paths;
if(cfg.tts.engine!=='volc')throw new Error('TTS_ENGINE_NOT_VOLC');
const P=projectPaths(process.argv[2]||'.'),only=process.argv.slice(3);
const moduleFile=cfg.tts.voicePolicy?.module;
if(!moduleFile)throw new Error('NARRATION_ADAPTER_REQUIRED');
const {selectionForProject,prepareRuntime,segmentStarts}=await import(pathToFileURL(moduleFile));
let selected;
if(cfg.tts.voicePolicy.enabled!==false){selected=selectionForProject(P.project);prepareRuntime(selected);}
else {
 const envFile=path.resolve(paths.ROOT,'../../.env');if(fs.existsSync(envFile))process.loadEnvFile(envFile);
 const speaker=cfg.tts.voice||process.env.VOLC_TTS_VOICE;if(!speaker)throw new Error('TTS_SPEAKER_REQUIRED');
 selected={speakerId:speaker,voiceName:cfg.tts.voiceName||speaker,resourceId:cfg.tts.resourceId||'seed-tts-2.0',speed:cfg.tts.speed};
 process.env.VOLC_TTS_RESOURCE_ID=selected.resourceId;process.env.VOLC_TTS_SPEED=String(Math.round((selected.speed-1)*100));
}
const scenes=JSON.parse(fs.readFileSync(P.script,'utf8'));
fs.mkdirSync(P.audio,{recursive:true});
for(const sc of scenes) {
  if(only.length&&!only.includes(sc.name))continue;
  const full=sc.segments.join(''),wav=path.join(P.audio,`${sc.name}.wav`);
  const result=await synthesize(full,wav,{voice:selected.speakerId});
  const starts=segmentStarts(sc.segments,result.words,result.duration);
  const meta={name:sc.name,duration:result.duration,segmentStarts:starts,segments:sc.segments,
    voice:selected.speakerId,voiceName:selected.voiceName,resourceId:selected.resourceId,speed:selected.speed,
    words:result.words.length,wordList:result.words.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ w=>({w:w.word,s:+w.startTime.toFixed(3),e:+w.endTime.toFixed(3)})),
    alignmentSource:'same Volc response; segment boundaries interpolated only within measured word bounds'};
  fs.writeFileSync(path.join(P.audio,`${sc.name}.json`),JSON.stringify(meta,null,2)+'\n');
  console.log(JSON.stringify({scene:sc.name,voice:selected.voiceName,duration:result.duration,words:result.words.length}));
}
