"""调查字幕：同次原生词时间戳，全文严格一致，缺项停止而不自动转写或估时。"""
from pathlib import Path
import argparse,json,re,unicodedata

def normal(text):
    """仅归一化有效文字，用于核对完整原稿与同次返回文本。"""
    return ''.join(c.lower() for c in unicodedata.normalize('NFKC',text) if c.isalnum())

def char_times_from_words(words,duration):
    """只在多字符实测词边界内插值；词序、边界和音频时长必须有效。"""
    letters=[];times=[];last=0
    if not words:raise ValueError('缺少同次合成词时间戳')
    for word in words:
        start=word['startTime'];end=word['endTime']
        if not 0<=start<end<=duration+.15 or start<last-.025:raise ValueError('无效词时间戳')
        text=normal(word['word']);count=len(text)
        for i,char in enumerate(text):
            letters.append(char);times.append((start+(end-start)*i/count,start+(end-start)*(i+1)/count))
        last=end
    return ''.join(letters),times

def tc(frame,fps):
    """将实际视频帧位置转换为SRT毫秒时码。"""
    ms=round(frame/fps*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

def main():
    """读取当期时间线及实际音频清单，逐段检查后生成完整字幕与对齐记录。"""
    parser=argparse.ArgumentParser();parser.add_argument('manifest',nargs='?',default='audio-manifest.json');parser.add_argument('--project',default='.');parser.add_argument('--fps',type=int,default=30)
    args=parser.parse_args();project=Path(args.project).resolve();fps=args.fps
    if fps<=0:raise ValueError('帧率须为正数')
    timeline=json.loads((project/'renderer/timeline.json').read_text(encoding='utf-8-sig'))
    manifest={item['id']:item for item in json.loads((project/args.manifest).read_text(encoding='utf-8-sig'))}
    subtitles=[];audit=[]
    for scene in timeline['scenes']:
        item=manifest[scene['id']];source,times=char_times_from_words(item.get('words'),item['duration'])
        if normal(scene['text'])!=source:raise ValueError('原稿与同次合成文本不一致，禁止近似补齐')
        clauses=re.findall(r'[^，。？！：；、]+[，。？！：；、]?',scene['text']);groups=[];pending=''
        for clause in clauses:
            if pending and len(normal(pending+clause))>22:groups.append(pending);pending=''
            pending+=clause
            if clause[-1] in '。？！' or len(normal(pending))>=17:groups.append(pending);pending=''
        if pending:groups.append(pending)
        cursor=0;local=[]
        for group in groups:
            count=len(normal(group))
            if not count:continue
            start=times[cursor][0];end=min(scene['duration'],times[cursor+count-1][1]+.12)
            local.append({'text':group.strip().strip('，。：；、'),'start':start,'end':end});cursor+=count
        for i,cue in enumerate(local):
            if i+1<len(local):cue['end']=min(cue['end'],local[i+1]['start'])
            start=scene['start']+round(cue['start']*fps);end=min(scene['end'],scene['start']+round(cue['end']*fps))
            if end<=start:raise ValueError('字幕时窗过短或越界')
            subtitles.append({'scene':scene['id'],'text':cue['text'],'start':start,'end':end})
        audit.append({'scene':scene['id'],'source':'same-volc-response','editRate':0,'characters':len(source),'wordInternalInterpolation':True})
    if ''.join(normal(s['text']) for s in subtitles)!=''.join(normal(s['text']) for s in timeline['scenes']):raise ValueError('完整字幕覆盖不一致')
    (project/'renderer/subtitles.json').write_text(json.dumps(subtitles,ensure_ascii=False,indent=2),encoding='utf8')
    (project/'alignment-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf8')
    (project/'subtitles.srt').write_text('\n\n'.join(f'{i+1}\n{tc(s["start"],fps)} --> {tc(s["end"],fps)}\n{s["text"]}' for i,s in enumerate(subtitles))+'\n',encoding='utf8')
    print('CAPTIONS_OK',len(subtitles),'same-provider-response')

if __name__=='__main__':main()
