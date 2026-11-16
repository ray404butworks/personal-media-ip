"""只检查公开源码、字体、许可证和注释；审计结果不代替独立人工复核。"""
from pathlib import Path
import ast, collections, hashlib, json, re, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]

def sources():
    """读取Git计划分发的文件，排除依赖、用户产物和已删除文件。"""
    try:
        if not (ROOT/'.git').exists():raise FileNotFoundError('下载包没有独立Git目录')
        names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT,stderr=subprocess.DEVNULL).decode('utf8').split('\0')
        return sorted({ROOT/name for name in names if name and (ROOT/name).is_file()})
    except (FileNotFoundError,subprocess.CalledProcessError):
        # 下载ZIP不含.git；只遍历分发目录，绝不扫描本机工作区或依赖缓存。
        result=[]
        for file in ROOT.rglob('*'):
            rel=file.relative_to(ROOT)
            if any(x in {'node_modules','workspace','.git','.local','__pycache__'} for x in rel.parts):continue
            if not file.is_file() or file.is_symlink():continue
            if file.name.startswith('.env') and file.name!='.env.example':continue
            if file.suffix in {'.zip','.log','.pyc'} or file.name.startswith(('BrandFont.','BodyFont.')):continue
            if rel.as_posix() in {'skills/whiteboard-video/config.json','skills/investigation-video/template/remotion/profile.json'}:continue
            if rel.parts[0]=='assets' and file.stem in {'bgm','logo'}:continue
            result.append(file)
        return sorted(result)

def package_inventory():
    """按各锁文件记录全部组件许可证，特殊许可与缺失项单列供复核。"""
    rows=[]
    for lock in [ROOT/'package-lock.json',ROOT/'skills/whiteboard-video/package-lock.json',ROOT/'skills/investigation-video/template/remotion/package-lock.json']:
        data=json.loads(lock.read_text(encoding='utf8'))
        for location,item in data.get('packages',{}).items():
            if not location:continue
            installed=lock.parent/location/'package.json';meta=json.loads(installed.read_text(encoding='utf8')) if installed.is_file() else {}
            name=meta.get('name') or location.split('node_modules/')[-1]
            license_value=meta.get('license') or item.get('license') or '未声明-需复核'
            row={'scope':lock.relative_to(ROOT).as_posix(),'name':name,'version':item.get('version'),'license':license_value,'optional':item.get('optional',False),'installed':installed.is_file()}
            if name=='@remotion/effects' and license_value=='UNLICENSED':
                row.update(effectiveLicense='Remotion License',resolution='Maintainer JonnyBurger explicitly confirmed effects is covered; published package declaration not yet aligned.',source='https://github.com/remotion-dev/remotion/issues/13403')
            rows.append(row)
    return rows

def run_audit():
    """汇总实际静态检查证据，输出可追溯结果，缺工具不冒充通过。"""
    files=sources();problems=[];python_functions=0;lambdas=[]
    for file in files:
        if file.suffix=='.py':
            tree=ast.parse(file.read_text(encoding='utf-8-sig'))
            for node in ast.walk(tree):
                if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)):
                    python_functions+=1
                    if not re.search('[\u3400-\u9fff]',ast.get_docstring(node) or ''):problems.append(f'{file.relative_to(ROOT)}:{node.lineno} 缺中文函数说明')
                elif isinstance(node,ast.Lambda):lambdas.append({'file':file.relative_to(ROOT).as_posix(),'line':node.lineno})
    node=subprocess.run(['node',str(ROOT/'scripts/check_comments.mjs')],cwd=ROOT,capture_output=True,text=True,encoding='utf8')
    if node.returncode:raise RuntimeError('JS函数注释或语法检查未通过：'+node.stderr[:200])
    js=json.loads(node.stdout)
    fonts=[]
    for file in files:
        if file.suffix.lower() in {'.ttf','.otf','.woff','.woff2','.ttc'}:
            license_file=file.parent/'OFL.txt'
            if not license_file.is_file():problems.append('字体缺少同目录许可证：'+file.relative_to(ROOT).as_posix())
            fonts.append({'file':file.relative_to(ROOT).as_posix(),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'license':'OFL-1.1' if license_file.is_file() else '待核对'})
    unsafe=[];servers=[]
    for file in files:
        if file.suffix.lower() not in {'.py','.js','.mjs','.cjs','.jsx','.html'}:continue
        text=file.read_text(encoding='utf-8-sig')
        for line_no,line in enumerate(text.splitlines(),1):
            # 扫描规则自身包含样式文本，避免把规则定义误判为生产入口。
            if file==Path(__file__):continue
            if re.search(r'\beval\s*\(|new Function\s*\(|shell\s*=\s*True|dangerouslySetInnerHTML',line):unsafe.append({'file':file.relative_to(ROOT).as_posix(),'line':line_no})
            if re.search(r'createServer\s*\(|\.listen\s*\(|HTTPServer\s*\(|@(?:app|router)\.(?:get|post|route)',line):servers.append({'file':file.relative_to(ROOT).as_posix(),'line':line_no})
    if unsafe:problems.append('存在需处理的动态代码或原始HTML风险入口')
    packages=package_inventory();licenses=collections.Counter(str(x['license']) for x in packages)
    report={'date':'2026-11-17','sourceFiles':len(files),'pythonFunctions':python_functions,'pythonLambdaExpressions':lambdas,'javascriptFunctions':js['functions'],'missingChineseFunctionComments':len(problems),'fonts':fonts,'fontSourceBytes':sum(f['bytes'] for f in fonts),'packageCount':len(packages),'licenseCounts':dict(licenses),'packages':packages,'specialLicensePackages':[x for x in packages if 'remotion' in x['name'].lower() or '未声明' in str(x['license']) or 'SEE LICENSE' in str(x['license'])],'unsafeExecutionSinks':unsafe,'backendOrTestRouteCandidates':servers,'issues':problems,'reviewBoundary':'自动语法树和文本检查，另有AI逐项源代码复核；没有独立人类复核签字。不是公网渗透测试或未知漏洞保证。'}
    target=ROOT/'docs/release-audit.json';target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({k:report[k] for k in ['sourceFiles','pythonFunctions','javascriptFunctions','packageCount','fontSourceBytes','issues']},ensure_ascii=False))
    if problems:raise SystemExit(1)

if __name__=='__main__':run_audit()
