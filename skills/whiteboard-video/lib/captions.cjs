// 字幕：文本用原文（scenes.js 里的旁白），时间借火山逐字时间戳。
// 对齐方式：按标点把原文和 TTS 词序列各切成小句，数量一致就一一配对（时间准、文本原样）；
// 先核对原文与同次音轨的实测词时间，再按标点分句；长句在对应词边界切分。
// 供渲染器烧录；并导出期目录 字幕.srt（发平台用）。
const fs = require('fs');
const path = require('path');
const { cfg, projectPaths, resolveProject } = require('./paths.cjs');

const CAP = cfg.captions;
const LEAD = cfg.render.leadSeconds, HOLD = cfg.render.holdSeconds;
const HARD = /[。？！；]$/;
const TRIM_END = /[，。；：、]+$/;
const norm = /* 归一化用于文字匹配的有效字符，不按字数估计真实语音时长。 */ (s) => [...s.normalize('NFKC').toLowerCase()].filter(/* 筛出满足当前检查条件的项，排除不适用数据。 */ (c) => /[\p{L}\p{N}]/u.test(c)).join('');
const nlen = /* 计算归一化有效字符数，辅助字幕分组。 */ (s) => norm(s).length;

// 原文按标点切小句（标点留在句尾）
function splitText(text) {
  return text.replace(/\s+/g, ' ').split(/(?<=[，。？！；：、])/).map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (s) => s.trim()).filter(/* 筛出满足当前检查条件的项，排除不适用数据。 */ (s) => nlen(s) > 0);
}
// 一个场景的 cue 列表（时间为场景内秒，已含 LEAD）
function cuesForScene(info) {
  const words = info.wordList || [];
  const text=(info.segments||[]).join('');
  if(!words.length||norm(text)!==norm(words.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ w=>w.w).join('')))throw Error('CAPTION_TRANSCRIPT_OR_TIMESTAMPS_INVALID');
  const positions=[];let last=0;
  for(const w of words){
    if(!Number.isFinite(w.s)||!Number.isFinite(w.e)||w.s<0||w.e<=w.s||w.s<last-.025||w.e>info.duration+.15)throw Error('CAPTION_WORD_TIME_INVALID');
    const n=nlen(w.w);for(let i=0;i<n;i++)positions.push({s:w.s+(w.e-w.s)*i/n,e:w.s+(w.e-w.s)*(i+1)/n});last=w.e;
  }
  // 只在同一实测词边界内插值，长句切分不再按整句时长平均分配。
  const clauses=[];let cursor=0;
  for(const part of splitText(text)){
    const n=nlen(part);clauses.push({text:part,n0:cursor,start:positions[cursor].s,end:positions[cursor+n-1].e});cursor+=n;
  }
  const merged=[];
  for(const c of clauses){
    const previous=merged[merged.length-1];
    if(previous&&!HARD.test(previous.text)&&(nlen(previous.text)<CAP.minChars||nlen(c.text)<3)&&nlen(previous.text)+nlen(c.text)<=CAP.maxChars){previous.text+=c.text;previous.end=c.end;}
    else merged.push({...c});
  }
  const cues=[];
  /** 沿文本找到可读断点，并从对应实测词位置取时间，不用整句比例估时。 */
  function splitLong(c){
    const n=nlen(c.text);if(n<=CAP.maxChars){cues.push(c);return;}
    const chars=[...c.text];let count=0,best=-1,distance=Infinity;
    const ideal=n/Math.ceil(n/CAP.maxChars);
    for(let i=1;i<chars.length;i++){
      count+=nlen(chars[i-1]);
      if(!(/\s/.test(chars[i])||(/[\u3400-\u9fff]/.test(chars[i-1])&&/[\u3400-\u9fff]/.test(chars[i]))))continue;
      if(Math.abs(count-ideal)<distance){distance=Math.abs(count-ideal);best=i;}
    }
    if(best<0){cues.push(c);return;}
    const left=chars.slice(0,best).join('').trim(),right=chars.slice(best).join('').trim(),cut=c.n0+nlen(left);
    cues.push({...c,text:left,end:positions[cut-1].e});
    splitLong({...c,text:right,n0:cut,start:positions[cut].s});
  }
  for(const c of merged)splitLong(c);
  // 显示文本去句尾标点；加 LEAD；首尾微调且不重叠
  for (let i = 0; i < cues.length; i++) {
    cues[i].text = cues[i].text.replace(TRIM_END, '');
    cues[i].start += LEAD; cues[i].end += LEAD;
  }
  for (let i = 0; i < cues.length; i++) {
    const prev = cues[i - 1], next = cues[i + 1];
    cues[i].start = Math.max(prev ? prev.end : 0, cues[i].start - CAP.leadSeconds);
    cues[i].end = Math.min(cues[i].end + CAP.tailSeconds, next ? next.start - 0.02 : info.duration + LEAD + HOLD);
    if (next && cues[i].end < cues[i].start + 0.3) cues[i].end = Math.min(cues[i].start + 0.3, next.start);
  }
  return cues.filter(/* 筛出满足当前检查条件的项，排除不适用数据。 */ (c) => c.text);
}

/* 读取工程场景及已生成旁白信息，按实际顺序累计。 */ function sceneInfos(P) {
  const script = JSON.parse(fs.readFileSync(P.script));
  return script.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (sc) => JSON.parse(fs.readFileSync(path.join(P.audio, `${sc.name}.json`))));
}

// 全片 SRT（按场景累计偏移）
function writeSrt(projectDir) {
  const P = projectPaths(projectDir);
  const infos = sceneInfos(P);
  let offset = 0, n = 0; const lines = [];
  const ts = /* 把秒值格式化为字幕所需的时间字符串。 */ (t) => { const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  for (const info of infos) {
    for (const c of cuesForScene(info)) lines.push(`${++n}\n${ts(offset + c.start)} --> ${ts(offset + c.end)}\n${c.text}\n`);
    offset += Math.ceil((info.duration + LEAD + HOLD) * cfg.render.fps) / cfg.render.fps;
  }
  const out = path.join(P.project, '字幕.srt');
  fs.writeFileSync(out, lines.join('\n'));
  return { file: out, count: n };
}

module.exports = { cuesForScene, writeSrt };

if (require.main === module) {
  const P = projectPaths(resolveProject(process.argv[2] || '.'));
  if (process.argv.includes('--dump')) {
    for (const info of sceneInfos(P)) { console.log(`## ${info.name}`); for (const c of cuesForScene(info)) console.log(`  ${c.start.toFixed(2)}-${c.end.toFixed(2)}  ${c.text}`); }
  } else { const r = writeSrt(P.project); console.log(`字幕 ${r.count} 条 → ${r.file}`); }
}
