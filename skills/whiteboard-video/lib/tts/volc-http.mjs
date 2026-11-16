// RayTalk: require one complete response for both audio and measured word timing.
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {digest,ttsIdentity,readAudioCache,writeAudioCache} from './content-cache.mjs';

const ENDPOINT='https://openspeech.bytedance.com/api/v3/tts/unidirectional';
export const normalizeText=/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ s=>[...String(s).normalize('NFKC').toLowerCase()].filter(/* 筛出满足当前检查条件的项，排除不适用数据。 */ c=>/[\p{L}\p{N}]/u.test(c)).join('');
export /* 由FFprobe读取真实音频时长，拒绝无效或空时长。 */ function getDuration(file) {
  const n=Number(execFileSync(process.env.FFPROBE||'ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',file],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());
  if(!Number.isFinite(n)||n<=0)throw new Error('TTS_AUDIO_DURATION_INVALID');return n;
}
/* 严格扫描NDJSON或SSE中的完整JSON，截断即报错。 */ function jsonObjects(raw) {
  const out=[];let depth=0,start=-1,inString=false,escape=false;
  for(let i=0;i<raw.length;i++) {const c=raw[i];
    if(inString){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')inString=false;}
    else if(c==='"')inString=true;
    else if(c==='{'){if(depth++===0)start=i;}
    else if(c==='}'&&--depth===0&&start>=0){out.push(JSON.parse(raw.slice(start,i+1)));start=-1;}
  }
  if(depth!==0||inString)throw new Error('TTS_RESPONSE_TRUNCATED');return out;
}
/* 递归收集音频片段和词时间，拒绝无效音频编码。 */ function collect(node,chunks,words) {
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node.words))words.push(...node.words);
  for(const [k,v] of Object.entries(node)) {
    if((k==='data'||k==='audio')&&typeof v==='string'&&v){if(!/^[A-Za-z0-9+/=\r\n]+$/.test(v))throw new Error('TTS_AUDIO_ENCODING_INVALID');chunks.push(Buffer.from(v,'base64'));}
    else if(v&&typeof v==='object'&&k!=='words')collect(v,chunks,words);
  }
}
export /* 要求完整成功结束、音频和非空时间戳，屏蔽服务商原始错误正文。 */ function parseVolcResponse(raw) {
  const chunks=[],words=[];let finished=false;
  for(const item of jsonObjects(raw)) {
    const code=Number(item.code);
    if(!Number.isFinite(code))throw new Error('TTS_RESPONSE_CODE_MISSING');
    if(code!==0&&code!==20000000)throw new Error(`TTS_PROVIDER_CODE_${code}`);
    if(finished)throw new Error('TTS_RESPONSE_AFTER_FINISH');
    if(code===20000000)finished=true;
    collect(item,chunks,words);
  }
  if(!finished)throw new Error('TTS_RESPONSE_INCOMPLETE');
  if(!chunks.length)throw new Error('TTS_AUDIO_MISSING');
  const unique=[],seen=new Set();
  for(const w of words){const key=JSON.stringify([w.word,w.startTime,w.endTime]);if(!seen.has(key)){seen.add(key);unique.push(w);}}
  if(!unique.length)throw new Error('TTS_WORD_TIMESTAMPS_MISSING');
  return {audio:Buffer.concat(chunks),words:unique};
}
export /* 校验词序、有效时间范围及规范化全文，不接受部分转写。 */ function validateAlignment(text,words,duration) {
  if(!Array.isArray(words)||!words.length)throw new Error('TTS_WORD_TIMESTAMPS_MISSING');
  let lastEnd=0;
  for(const w of words){const s=w.startTime,e=w.endTime;if(typeof w.word!=='string'||!Number.isFinite(s)||!Number.isFinite(e)||s<0||e<=s||s<lastEnd-.025||e>duration+.15)throw new Error('TTS_WORD_TIMESTAMPS_INVALID');lastEnd=e;}
  if(!normalizeText(text)||normalizeText(words.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ w=>w.word).join(''))!==normalizeText(text))throw new Error('TTS_TRANSCRIPT_MISMATCH');return true;
}
export /* 从同次合成词时间计算各段起点，只在多字符词内插值。 */ function segmentStarts(segments,words,duration) {
  validateAlignment(segments.join(''),words,duration);const chars=[];
  for(const w of words){const n=normalizeText(w.word).length;for(let i=0;i<n;i++)chars.push(w.startTime+(w.endTime-w.startTime)*i/n);}
  let cursor=0;const starts=segments.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ seg=>{const n=normalizeText(seg).length;if(!n)throw new Error('TTS_EMPTY_SEGMENT');const t=chars[cursor];cursor+=n;return t;});starts[0]=0;return starts;
}
export /* 复用已验证缓存或请求一次真实合成，音频和时间戳同时验证。 */ async function synthesize(text,outWav,{voice}={}) {
  if(!outWav.toLowerCase().endsWith('.wav'))throw new Error('TTS_OUTPUT_MUST_BE_WAV');
  if(process.env.TTS_ENGINE&&process.env.TTS_ENGINE!=='volc')throw new Error('TTS_ENGINE_OVERRIDE_NOT_ALLOWED');
  const speaker=voice||process.env.VOLC_TTS_VOICE;if(!speaker)throw new Error('TTS_SPEAKER_REQUIRED');
  const resource=process.env.VOLC_TTS_RESOURCE_ID||'seed-tts-2.0',speed=Number(process.env.VOLC_TTS_SPEED||0);
  if(!Number.isFinite(speed)||speed< -50||speed>100)throw new Error('TTS_SPEED_INVALID');
  const key=digest(ttsIdentity(text,speaker)),cached=process.env.FORCE_TTS!=='1'&&readAudioCache(outWav,key);
  if(cached){try{validateAlignment(text,cached.words,cached.duration);return cached;}catch{/* Invalid old cache must be regenerated. */}}
  const headers={'Content-Type':'application/json','X-Api-Resource-Id':resource,'X-Api-Request-Id':randomUUID()};
  if(process.env.VOLC_TTS_API_KEY)headers['X-Api-Key']=process.env.VOLC_TTS_API_KEY;
  else if(process.env.VOLC_TTS_APP_ID&&process.env.VOLC_TTS_ACCESS_TOKEN){headers['X-Api-App-Id']=process.env.VOLC_TTS_APP_ID;headers['X-Api-Access-Key']=process.env.VOLC_TTS_ACCESS_TOKEN;}
  else throw new Error('TTS_CREDENTIALS_MISSING');
  const req={text,speaker,audio_params:{format:'mp3',sample_rate:24000,bit_rate:128000,enable_timestamp:true,enable_subtitle:true,speech_rate:speed}};
  if(process.env.VOLC_TTS_STYLE)req.additions=JSON.stringify({context_texts:[process.env.VOLC_TTS_STYLE]});
  let response,raw;
  try{response=await fetch(ENDPOINT,{method:'POST',headers,signal:AbortSignal.timeout(120000),body:JSON.stringify({user:{uid:'raytalk'},req_params:req})});if(!response.ok)throw new Error(`TTS_HTTP_${response.status}`);raw=await response.text();}
  catch(e){if(/^TTS_HTTP_\d+$/.test(e.message))throw e;throw new Error('TTS_NETWORK_OR_TIMEOUT');}
  // Provider response bodies must never enter logs or delivery files.
  let parsed;try{parsed=parseVolcResponse(raw);}catch(e){throw new Error(/^TTS_[A-Z0-9_]+$/.test(e.message)?e.message:'TTS_RESPONSE_INVALID');}
  fs.mkdirSync(path.dirname(outWav),{recursive:true});
  const token=randomUUID(),mp3=outWav+'.'+token+'.mp3',wav=outWav+'.'+token+'.wav';
  try {
    fs.writeFileSync(mp3,parsed.audio);
    try{execFileSync(process.env.FFMPEG||'ffmpeg',['-nostdin','-y','-v','error','-i',mp3,'-ar','44100','-ac','2',wav],{stdio:'ignore'});}catch{throw new Error('TTS_AUDIO_CONVERSION_FAILED');}
    const duration=getDuration(wav);validateAlignment(text,parsed.words,duration);
    fs.renameSync(wav,outWav);const audio={path:outWav,duration,words:parsed.words};writeAudioCache(outWav,key,audio);return audio;
  } finally{fs.rmSync(mp3,{force:true});fs.rmSync(wav,{force:true});}
}
