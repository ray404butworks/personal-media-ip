"""验齐一条视频的交付材料，生成实体文件、校验清单及发布素材ZIP。"""
from pathlib import Path
import argparse, hashlib, json, re, shutil, subprocess, zipfile, unicodedata
from PIL import Image
from apply_config import ROOT, load
from check_publish import check

def digest(file):
    """计算文件指纹，用于确认交付内容与已检查的成片完全一致。"""
    return hashlib.sha256(file.read_bytes()).hexdigest()

def inside(project, value):
    """只接受工程内实体来源，阻止路径穿越、外部软链及凭据文件打包。"""
    file=(project/value).resolve()
    if not file.is_relative_to(project) or not file.is_file():
        raise ValueError('交付来源必须是工程内存在的文件')
    if file.name.startswith('.env') or any(x in {'.git','node_modules','.local'} for x in file.relative_to(project).parts):
        raise ValueError('拒绝打包凭据、依赖或本地状态')
    return file

def normalized(text):
    """仅归一化空白、标点和字宽，保留口播文字与数字顺序供完整性检查。"""
    return ''.join(c.lower() for c in unicodedata.normalize('NFKC',text) if c.isalnum())

def finalize(project, title, version=1):
    """先通过音画与材料门槛，再冻结交付，既有版本一律保留。"""
    project=Path(project).resolve()
    if not title or any(c in title for c in '/\\:*?"<>|') or version<1:
        raise ValueError('题名或版本无效')
    manifest=load(project/'delivery-manifest.json')
    required=['video','subtitles','speechText','cover43','cover34','publishCopy','wechatMd','wechatTxt','qa','playbackQa']
    files={key:inside(project,manifest[key]) for key in required}
    for name in ['受众审查.json','旁白选择.json']:inside(project,name)
    qa=load(files['qa']);play=load(files['playbackQa'])
    if qa.get('sha256')!=digest(files['video']) or not qa.get('sourceTextMatches') or not qa.get('scopeNotesExcludedFromTtsAndSrt'):
        raise ValueError('成片指纹、原文或范围注记检查未通过')
    if not play.get('end',{}).get('ended') or play.get('errors') or play.get('end',{}).get('error'):
        raise ValueError('缺少通过的实际播放器抽检')
    probe=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_type,width,height,r_frame_rate','-of','json',str(files['video'])],capture_output=True,text=True,check=True)
    info=json.loads(probe.stdout)
    if not any(s['codec_type']=='audio' for s in info['streams']):raise ValueError('成片缺少音轨')
    decode=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(files['video']),'-f','null','-'],capture_output=True,text=True)
    if decode.returncode or decode.stderr.strip():raise ValueError('完整音画解码未通过')
    srt=files['subtitles'].read_text(encoding='utf-8-sig')
    text=''.join(re.sub(r'^\d+\n[^\n]*-->[^\n]*\n','',block.strip()) for block in re.split(r'\n\s*\n',srt))
    if normalized(text)!=normalized(files['speechText'].read_text(encoding='utf-8-sig')):raise ValueError('字幕原文不一致')
    stamps=re.findall(r'(\d\d):(\d\d):(\d\d),(\d{3})',srt)
    times=[int(h)*3600+int(m)*60+int(s)+int(ms)/1000 for h,m,s,ms in stamps]
    if not times or len(times)%2 or any(times[i]>=times[i+1] for i in range(0,len(times),2)) or any(a>b for a,b in zip(times,times[1:])) or times[-1]>float(info['format']['duration'])+.04:raise ValueError('字幕时间越界或无序')
    for key,ratio in [('cover43',4/3),('cover34',3/4)]:
        with Image.open(files[key]) as image:
            if abs(image.width/image.height-ratio)>.001:raise ValueError('封面比例不符')
    if files['wechatMd'].read_bytes()!=files['wechatTxt'].read_bytes():raise ValueError('公众号MD与TXT不一致')
    cfg=load(ROOT/'config.json');platforms=load(ROOT/cfg['writing']['workflowFile'])['platforms']
    if check(files['publishCopy'].read_text(encoding='utf-8-sig'),platforms,cfg['brand']['name']):raise ValueError('四平台文案校验未通过')
    copies=manifest['platformTxt']
    if len(copies)!=len(platforms):raise ValueError('缺少逐平台TXT')
    records=[inside(project,f) for f in manifest['records']]
    if len(records)<3:raise ValueError('须提供来源、审校和检查记录')
    out=project/'outputs'/f'{title}-完整交付v{version}'
    archive=out.parent/f'{title}-发布素材v{version}.zip'
    if out.exists() or archive.exists():raise ValueError('交付版本已存在，请使用新版本')
    # 先校验全部来源，防止缺项时创建可被误认为完成的目录。
    platform_files=[inside(project,f) for f in copies]
    source_files=list(files.values())+records+platform_files+[inside(project,'受众审查.json'),inside(project,'旁白选择.json')]
    secret_values=[]
    env=ROOT/'.env'
    if env.exists():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key,value=line.split('=',1);value=value.strip().strip('\"\'')
                if re.search('KEY|TOKEN|SECRET|PASSWORD',key,re.I) and len(value)>=8:secret_values.append(value)
    for file in source_files:
        if file.suffix.lower() in {'.txt','.md','.json','.srt'}:
            if any(v in file.read_text(encoding='utf-8-sig') for v in secret_values):raise ValueError('凭据扫描未通过')
    out.mkdir(parents=True);pub=out/'发布包';pub.mkdir();rec=out/'来源与检查';rec.mkdir()
    shutil.copy2(files['video'],out/f'{title}-完整v{version}.mp4')
    shutil.copy2(files['subtitles'],out/f'{title}-字幕v{version}.srt')
    for key,name in [('cover43','封面-4x3.png'),('cover34','封面-3x4.png'),('publishCopy','四平台发布文案.md'),('wechatMd','微信公众号文章.md'),('wechatTxt','微信公众号文章.txt')]:shutil.copy2(files[key],pub/name)
    for i,(file,platform) in enumerate(zip(platform_files,platforms),1):shutil.copy2(file,pub/f'{i:02d}-{platform["name"]}.txt')
    record_files=records+[files['qa'],files['playbackQa'],files['speechText'],inside(project,'受众审查.json'),inside(project,'旁白选择.json')]
    for i,file in enumerate(record_files,1):shutil.copy2(file,rec/f'{i:02d}-{file.name}')
    (out/'先读我.md').write_text(f'# {title}\n\n完整v{version}，已制作，未公开发布。\n\n成片、字幕、双封面、四平台文案、微信公众号文章及来源/检查记录随包。\n\n已通过机器检查及播放器抽样；人类复核与全片人工听审以附带记录为准，不由脚本代签。\n',encoding='utf8')
    listing=[{'path':f.relative_to(out).as_posix(),'bytes':f.stat().st_size,'sha256':digest(f)} for f in sorted(out.rglob('*')) if f.is_file()]
    (out/'交付清单.json').write_text(json.dumps(listing,ensure_ascii=False,indent=2),encoding='utf8')
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
        for f in sorted(out.rglob('*')):
            if f.is_file() and f.suffix.lower()!='.mp4':z.write(f,str(Path(out.name)/f.relative_to(out)))
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:raise ValueError('ZIP完整性校验失败')
    print('DELIVERY_READY',out,archive)
    return out

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('project');parser.add_argument('--title',required=True);parser.add_argument('--version',type=int,default=1)
    args=parser.parse_args();finalize(args.project,args.title,args.version)
