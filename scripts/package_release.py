"""按Git公开文件列表打包工作流，排除依赖、凭据、用户成片与本机状态。"""
from pathlib import Path
import argparse, hashlib, json, re, zipfile
from release_audit import ROOT, sources

def package(output):
    """生成带逐文件指纹的可迁移ZIP，并验证所有压缩条目和敏感值边界。"""
    output=Path(output).resolve()
    if output.exists():raise ValueError('保留已有包，请使用新的输出文件名')
    files=sources();secrets=[]
    env=ROOT/'.env'
    if env.exists():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key,value=line.split('=',1);value=value.strip().strip('\"\'')
                if re.search('KEY|TOKEN|SECRET|PASSWORD',key,re.I) and len(value)>=8:secrets.append(value)
    listing=[]
    for file in files:
        rel=file.relative_to(ROOT)
        if any(x in {'node_modules','workspace','.git','.local','__pycache__'} for x in rel.parts) or file.name.startswith('.env') and file.name!='.env.example':raise ValueError('公开文件列表包含受保护条目')
        if file.suffix.lower() in {'.mp4','.wav','.mp3','.zip','.pyc'}:raise ValueError('源码包不得夹带成片、音频、压缩包或缓存')
        data=file.read_bytes()
        if file.suffix.lower() in {'.md','.txt','.json','.py','.js','.mjs','.cjs','.jsx','.html','.example'}:
            text=data.decode('utf-8-sig')
            if any(secret in text for secret in secrets):raise ValueError('源码包密钥值检查未通过')
        listing.append({'path':rel.as_posix(),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for item in listing:archive.write(ROOT/item['path'],'personal-media-ip/'+item['path'])
        archive.writestr('personal-media-ip/PACKAGE-MANIFEST.json',json.dumps(listing,ensure_ascii=False,indent=2))
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:raise ValueError('压缩包CRC校验失败')
        for item in listing:
            if hashlib.sha256(archive.read('personal-media-ip/'+item['path'])).hexdigest()!=item['sha256']:raise ValueError('压缩包内容指纹不符')
    report={'file':output.name,'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'sourceFiles':len(files),'crcPassed':True,'secretValuesExcluded':True}
    print(json.dumps(report,ensure_ascii=False));return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('output');args=parser.parse_args();package(args.output)
