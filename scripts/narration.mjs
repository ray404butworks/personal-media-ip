// The production AI supplies the audience review; this module locks and applies its choice.
import fs from 'node:fs';
import path from 'node:path';
import {randomInt,createHash,randomUUID} from 'node:crypto';
import {parseEnv} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {synthesize,segmentStarts,normalizeText,validateAlignment} from '../skills/whiteboard-video/lib/tts/volc-http.mjs';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const POLICY_FILE=path.join(ROOT,'workflow/旁白音色配置.json');
export const loadPolicy=/* 读取当前仓库的声音策略，不借用原作者机器上的配置。 */ ()=>JSON.parse(fs.readFileSync(POLICY_FILE,'utf8'));
const save=/* 将元数据按UTF8保存，保留中文与可读缩进。 */ (file,obj)=>fs.writeFileSync(file,JSON.stringify(obj,null,2)+'\n');
export /* 读取音色专属语速并校验范围，优先于全局默认。 */ function voiceSpeed(voice,policy=loadPolicy()) {
  const speed=Number(voice?.speed??policy.speed);
  if(!Number.isFinite(speed)||speed<.5||speed>2)throw new Error('NARRATOR_SPEED_INVALID');return speed;
}
/* 读取整期锁声并保留声音身份；语速变化记入历史。 */ function readSelection(file,policy) {
  const old=JSON.parse(fs.readFileSync(file,'utf8'));
  const voice=policy.voices.find(/* 查找满足当前身份或边界条件的首个匹配项。 */ v=>v.speakerId===old.speakerId&&v.name===old.voiceName);
  if(!voice)throw new Error('NARRATOR_SELECTION_INVALID_OR_STALE');
  const speed=voiceSpeed(voice,policy);
  if(old.speed===speed)return validateSelection(old,policy);
  const updated=validateSelection({...old,speed,speedHistory:[...(old.speedHistory||[]),{speed:old.speed,replacedAt:new Date().toISOString()}]},policy);
  const temp=file+'.'+randomUUID()+'.tmp';
  try{save(temp,updated);fs.renameSync(temp,file);}finally{fs.rmSync(temp,{force:true});}return updated;
}
export /* 仅在本机读取凭据并设置当前音色资源和语速，不输出秘密。 */ function prepareRuntime(selection) {
  const policy=loadPolicy(),file=path.resolve(ROOT,policy.credentialsFile||'.env');
  const env={...process.env,...(fs.existsSync(file)?parseEnv(fs.readFileSync(file,'utf8')):{})};
  const key=(env.VOLC_TTS_API_KEY||'').trim(),app=(env.VOLC_TTS_APP_ID||'').trim(),token=(env.VOLC_TTS_ACCESS_TOKEN||'').trim();
  if(!key&&!(app&&token))throw new Error('TTS_CREDENTIALS_MISSING');
  for(const value of [key,app,token].filter(Boolean))if(/^(your|<|这里|请|填|xxx)/i.test(value)||/\s/.test(value))throw new Error('TTS_CREDENTIALS_INVALID');
  for(const name of ['VOLC_TTS_API_KEY','VOLC_TTS_APP_ID','VOLC_TTS_ACCESS_TOKEN']){if(env[name])process.env[name]=env[name];else delete process.env[name];}
  process.env.VOLC_TTS_RESOURCE_ID=selection.resourceId;process.env.VOLC_TTS_SPEED=String(Math.round((selection.speed-1)*100));
  delete process.env.TTS_ENGINE;delete process.env.VOLC_TTS_STYLE;
  process.env.FFMPEG=env.FFMPEG||'ffmpeg';process.env.FFPROBE=env.FFPROBE||'ffprobe';
}
export /* 检查锁声记录与当前声池、资源、依据类型及语速一致。 */ function validateSelection(s,policy=loadPolicy()) {
  const voice=policy.voices.find(/* 查找满足当前身份或边界条件的首个匹配项。 */ v=>v.speakerId===s.speakerId&&v.name===s.voiceName),pool=policy.selection.pools[s.audience];
  if(!voice||!pool||(!s.explicitOverride&&!pool.includes(voice.key))||s.resourceId!==policy.resourceId||s.speed!==voiceSpeed(voice,policy)||!s.topic||!s.reason||!['editorial','analytics','explicit-user'].includes(s.basisType))throw new Error('NARRATOR_SELECTION_INVALID_OR_STALE');return s;
}
export /* 校验AI受众审查后等概率抽声，原子锁定整期并拒绝冲突。 */ function selectNarrator(project,review,policy=loadPolicy()) {
  if(!review||!policy.selection.pools[review.audience]||!review.topic?.trim()||!review.reason?.trim()||!['editorial','analytics','explicit-user'].includes(review.basisType))throw new Error('AUDIENCE_REVIEW_REQUIRED');
  const file=path.join(project,policy.selection.lockFile);
  if(fs.existsSync(file)){const selected=readSelection(file,policy);if(selected.topic!==review.topic||selected.audience!==review.audience||(review.voiceKey&&selected.voiceKey!==review.voiceKey))throw new Error('NARRATOR_LOCK_CONFLICT_CREATE_A_NEW_VERSION');return selected;}
  const pool=policy.selection.pools[review.audience];if(review.voiceKey&&review.basisType!=='explicit-user')throw new Error('VOICE_OVERRIDE_REQUIRES_USER_INSTRUCTION');
  const key=review.voiceKey||pool[randomInt(pool.length)],voice=policy.voices.find(/* 查找满足当前身份或边界条件的首个匹配项。 */ v=>v.key===key);if(!voice)throw new Error('NARRATOR_UNKNOWN_VOICE');
  const selected={schemaVersion:1,topic:review.topic,audience:review.audience,reason:review.reason,basisType:review.basisType,voiceKey:key,voiceName:voice.name,speakerId:voice.speakerId,resourceId:policy.resourceId,speed:voiceSpeed(voice,policy),explicitOverride:!!review.voiceKey,selectedAt:new Date().toISOString()};
  validateSelection(selected,policy);fs.mkdirSync(project,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
  try{save(temp,selected);fs.linkSync(temp,file);}catch(e){if(e.code==='EEXIST')return selectNarrator(project,review,policy);throw e;}finally{fs.rmSync(temp,{force:true});}return selected;
}
export /* 优先复用已有审查和锁声，缺少两者时停止。 */ function selectionForProject(project) {
  const policy=loadPolicy(),review=path.join(project,'受众审查.json'),lock=path.join(project,policy.selection.lockFile);
  if(fs.existsSync(review))return selectNarrator(project,JSON.parse(fs.readFileSync(review,'utf8')),policy);
  if(fs.existsSync(lock))return readSelection(lock,policy);
  throw new Error('AUDIENCE_REVIEW_REQUIRED');
}
export /* 沿输出目录向上查找工程审查或锁声，不猜测所属选题。 */ function findProject(output) {
  let dir=path.dirname(path.resolve(output));while(true){if(fs.existsSync(path.join(dir,'旁白选择.json'))||fs.existsSync(path.join(dir,'受众审查.json')))return dir;const parent=path.dirname(dir);if(parent===dir)throw new Error('NARRATOR_PROJECT_REQUIRED');dir=parent;}
}
export /* 根据同次词时间分组SRT并核对全部原文。 */ function subtitles(text,words) {
  const cues=[];let group=[],n=0;
  for(const w of words){group.push(w);n+=normalizeText(w.word).length;if(/[。！？；，、：.!?;,:]$/.test(w.word)||n>=18){cues.push({text:group.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ x=>x.word).join(''),start:group[0].startTime,end:group.at(-1).endTime});group=[];n=0;}}
  if(group.length)cues.push({text:group.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ x=>x.word).join(''),start:group[0].startTime,end:group.at(-1).endTime});
  if(normalizeText(cues.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ c=>c.text).join(''))!==normalizeText(text))throw new Error('CAPTION_TEXT_MISMATCH');
  const tc=/* 将实际时间格式化为SRT时码。 */ t=>{const m=Math.round(t*1000);return `${String(Math.floor(m/3600000)).padStart(2,'0')}:${String(Math.floor(m/60000)%60).padStart(2,'0')}:${String(Math.floor(m/1000)%60).padStart(2,'0')},${String(m%1000).padStart(3,'0')}`;};
  return cues.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (c,i)=>`${i+1}\n${tc(c.start)} --> ${tc(c.end)}\n${c.text}\n`).join('\n');
}
export /* 在锁定声音下合成，保存同次时间戳、原文指纹和局部字幕。 */ async function synthesizeNarration(text,output,selection) {
  validateSelection(selection);prepareRuntime(selection);const result=await synthesize(text,output,{voice:selection.speakerId});validateAlignment(text,result.words,result.duration);
  save(output+'.json',{...result,text,textSha256:createHash('sha256').update(text).digest('hex'),voiceName:selection.voiceName,speakerId:selection.speakerId,resourceId:selection.resourceId,speed:selection.speed,timingSource:'same-provider-response',characterPositions:'interpolated-only-within-measured-word-boundaries'});
  fs.writeFileSync(output.replace(/\.wav$/i,'.srt'),subtitles(text,result.words));return result;
}
export {segmentStarts};
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try{const [command,project,input,output]=process.argv.slice(2);
    if(command==='select'){const s=selectionForProject(path.resolve(project));console.log(JSON.stringify({voice:s.voiceName,audience:s.audience,locked:true}));}
    else if(command==='synthesize'&&project&&input&&output){const s=selectionForProject(path.resolve(project)),r=await synthesizeNarration(fs.readFileSync(input,'utf8'),path.resolve(output),s);console.log(JSON.stringify({voice:s.voiceName,duration:r.duration,words:r.words.length,audio:r.path}));}
    else throw new Error('USAGE: narration.mjs select PROJECT | synthesize PROJECT INPUT.txt OUTPUT.wav');
  }catch(e){console.error(String(e.message).split(':')[0]);process.exitCode=1;}
}
