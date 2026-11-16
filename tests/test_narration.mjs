// 离线验证：错误响应拒绝、受众池、锁定、语速和缓存，不调用真实付费服务。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseVolcResponse,validateAlignment,segmentStarts} from '../skills/whiteboard-video/lib/tts/volc-http.mjs';
import {loadPolicy,selectNarrator,subtitles,selectionForProject,voiceSpeed,prepareRuntime} from '../scripts/narration.mjs';
import {digest,ttsIdentity,writeAudioCache} from '../skills/whiteboard-video/lib/tts/content-cache.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const area=path.join(root,'.local/tests');fs.mkdirSync(area,{recursive:true});
const dir=fs.mkdtempSync(path.join(area,'narration-'));
const policy=loadPolicy(),words=[{word:'先',startTime:.1,endTime:.3},{word:'看。',startTime:.3,endTime:.6}];
const frame=JSON.stringify({code:0,data:Buffer.from('audio').toString('base64'),sentence:{words}}),finish=JSON.stringify({code:20000000});
assert.equal(parseVolcResponse(frame+'\n'+finish).words.length,2);
assert.equal(parseVolcResponse('event: 352\ndata: '+frame+'\n\nevent: 152\ndata: '+finish).audio.toString(),'audio');
assert.throws(/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ ()=>parseVolcResponse(frame),/INCOMPLETE/);
assert.throws(/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ ()=>parseVolcResponse(frame+'\n'+JSON.stringify({code:45000000,message:'not retained'})),/PROVIDER_CODE_45000000/);
assert.throws(/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ ()=>parseVolcResponse(JSON.stringify({code:0,data:'YQ=='})+finish),/TIMESTAMPS_MISSING/);
assert.throws(/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ ()=>parseVolcResponse(frame+'\n{"code":'),/TRUNCATED/);
assert.equal(validateAlignment('先看。',words,1),true);
assert.throws(/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ ()=>validateAlignment('看先',words,1),/TRANSCRIPT_MISMATCH/);
assert.throws(/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ ()=>validateAlignment('先看',words,.4),/TIMESTAMPS_INVALID/);
assert.throws(/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ ()=>validateAlignment('先看',[words[1],words[0]],1),/TIMESTAMPS_INVALID/);
assert.deepEqual(segmentStarts(['先','看。'],words,1),[0,.3]);
assert.match(subtitles('先看。',words),/00:00:00,100 --> 00:00:00,600/);
for(const audience of ['male','female','mixed']){
 const project=path.join(dir,audience),review={topic:'离线测试',audience,reason:'检查声池和锁定；没有真实受众比例。',basisType:'editorial'};
 const first=selectNarrator(project,review,policy);assert(policy.selection.pools[audience].includes(first.voiceKey));
 assert.deepEqual(selectNarrator(project,review,policy),first);assert.deepEqual(selectionForProject(project),first);
 assert.throws(/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ ()=>selectNarrator(project,{...review,topic:'新选题'},policy),/LOCK_CONFLICT/);
}
assert.throws(/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ ()=>selectNarrator(path.join(dir,'missing'),{}),/AUDIENCE_REVIEW_REQUIRED/);
assert.throws(/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ ()=>selectNarrator(path.join(dir,'override'),{topic:'测试',audience:'male',reason:'测试',basisType:'editorial',voiceKey:'xinlingjitang'}),/OVERRIDE_REQUIRES/);
process.env.VOLC_TTS_API_KEY='offline-test-credential-not-real';
for(const [key,speed,rate] of [['xiaotian',1.1,'10'],['youyoujunzi',1.1,'10'],['xinlingjitang',1.2,'20']]){
 const voice=policy.voices.find(/* 查找满足当前身份或边界条件的首个匹配项。 */ v=>v.key===key);assert.equal(voiceSpeed(voice,policy),speed);
 const project=path.join(dir,'speed-'+key),review={topic:'语速测试',audience:voice.gender,reason:'用户明确选声的离线用例',basisType:'explicit-user',voiceKey:key};
 const selected=selectNarrator(project,review,policy);prepareRuntime(selected);assert.equal(process.env.VOLC_TTS_SPEED,rate);
 const lock=path.join(project,policy.selection.lockFile);fs.writeFileSync(lock,JSON.stringify({...selected,speed:1.2}));
 const updated=selectionForProject(project);assert.equal(updated.speed,speed);assert.equal(updated.speakerId,selected.speakerId);assert.equal(updated.selectedAt,selected.selectedAt);
 if(speed!==1.2){assert.equal(updated.speedHistory.at(-1).speed,1.2);assert.notEqual(digest(ttsIdentity('检查',voice.speakerId,{VOLC_TTS_SPEED:rate})),digest(ttsIdentity('检查',voice.speakerId,{VOLC_TTS_SPEED:'20'})));}
}
// 用真正可解码的合成测试音检查两个制作入口，网络被显式禁止。
const project=path.join(dir,'adapter');fs.mkdirSync(path.join(project,'scenes'),{recursive:true});
const review={topic:'适配测试',audience:'female',reason:'离线检查格式；非生产受众判断',basisType:'editorial'};
fs.writeFileSync(path.join(project,'受众审查.json'),JSON.stringify(review));const selected=selectNarrator(project,review);
prepareRuntime(selected);
const source=path.join(project,'source.wav');
execFileSync(process.env.FFMPEG||'ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=1','-ar','44100','-ac','2',source]);
const paths=(await import('../skills/whiteboard-video/lib/paths.cjs')).default.projectPaths(project);
fs.mkdirSync(paths.audio,{recursive:true});
fs.writeFileSync(path.join(project,'scenes/script.json'),JSON.stringify([{name:'01-test',segments:['先','看。']}]));
const preload=path.join(project,'block-network.mjs');fs.writeFileSync(preload,"globalThis.fetch=()=>{throw Error('UNEXPECTED_NETWORK')};\n");
/** 给指定输出写入已校验内容缓存，只服务于本离线用例。 */
function cache(output){fs.copyFileSync(source,output);writeAudioCache(output,digest(ttsIdentity('先看。',selected.speakerId)),{duration:1,words});}
cache(path.join(paths.audio,'01-test.wav'));
const env={...process.env};
execFileSync(process.execPath,['--import',pathToFileURL(preload).href,path.join(root,'skills/whiteboard-video/lib/tts-volc.mjs'),project],{env,stdio:'pipe'});
const info=JSON.parse(fs.readFileSync(path.join(paths.audio,'01-test.json'),'utf8'));
assert.equal(info.voice,selected.speakerId);assert.deepEqual(info.segmentStarts,[0,.3]);assert.equal(info.wordList.length,2);
const out=path.join(project,'investigation.wav');cache(out);
const harness=path.join(project,'run.mjs');fs.writeFileSync(harness,`import {synthesize} from ${JSON.stringify(pathToFileURL(path.join(root,'skills/investigation-video/scripts/tts.mjs')).href)};const r=await synthesize('先看。',${JSON.stringify(out)},{projectDir:${JSON.stringify(project)}});if(r.words.length!==2)throw Error('WORDS_LOST');`);
execFileSync(process.execPath,['--import',pathToFileURL(preload).href,harness],{env,stdio:'pipe'});
console.log('NARRATION_CHECKS_OK: strict response, transcript, timing, pools, locks, native speeds, cache and both adapters');

// 特别检查长字幕按词时间断开，快慢不同的两段不得被均分。
const {cuesForScene}=await import('../skills/whiteboard-video/lib/captions.cjs');
const slow='一二三四五六七八九十甲乙丙丁戊己庚辛壬癸',fast='子丑寅卯辰巳午未申酉戌亥乾坤震巽坎离艮兑';
const cues=cuesForScene({duration:11,segments:[slow+fast],wordList:[{w:slow,s:0,e:10},{w:fast,s:10,e:11}]});
assert.equal(cues[0].text,slow);assert(cues[1].start>=10);
assert.throws(/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ ()=>cuesForScene({duration:1,segments:['错稿'],wordList:[{w:'先看',s:0,e:1}]}),/TRANSCRIPT/);
console.log('MEASURED_CAPTION_SPLIT_OK');
