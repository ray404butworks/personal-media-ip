// 调查项目与白板共用受众审查、整期音色锁和原生时间戳校验。
import path from 'node:path';
import * as adapter from '../../../scripts/narration.mjs';
export {getDuration} from '../../whiteboard-video/lib/tts/volc-http.mjs';
export /* 复用已验证缓存或请求一次真实合成，音频和时间戳同时验证。 */ async function synthesize(text,outWav,{voice,projectDir}={}) {
 const project=projectDir||process.env.RAYTALK_PROJECT||adapter.findProject(outWav);
 const selected=adapter.selectionForProject(path.resolve(project));
 if(voice&&voice!==selected.speakerId)throw new Error('VOICE_CONFLICT_WITH_EPISODE_LOCK');
 return adapter.synthesizeNarration(text,outWav,selected);
}
