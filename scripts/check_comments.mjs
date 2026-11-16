// 用语法树检查函数中文注释，包含匿名回调、类方法及HTML内联脚本。
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from '@babel/parser';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const chinese=/[\u3400-\u9fff]/;
const kinds=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ObjectMethod','ClassMethod','ClassPrivateMethod']);
/** 遍历语法节点并保留父节点，用于给匿名回调找到所属操作。 */
function walk(node,parent,visit){
 if(!node||typeof node!=='object')return;
 if(node.type)visit(node,parent);
 for(const [key,value] of Object.entries(node)){
  if(['loc','tokens','comments','leadingComments','trailingComments','innerComments'].includes(key))continue;
  if(Array.isArray(value)){for(const child of value)walk(child,node,visit);}
  else if(value&&typeof value==='object')walk(value,node,visit);
 }
}
/** 读取Git选中的实际源码，跳过删除项、缓存、依赖及用户生成文件。 */
function sourceFiles(){
 try{if(!fs.existsSync(path.join(root,'.git')))return scanFolder(root);return execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(/* 只保留存在的公开JS、JSX和HTML源码。 */ file=>file&&fs.existsSync(path.join(root,file))&&/\.(?:mjs|cjs|jsx?|html)$/.test(file));}
 catch{return scanFolder(root);}
}
/** 为不含Git元数据的下载包枚举源码，跳过依赖、本机状态和用户生成目录。 */
function scanFolder(folder){
 const files=[];
 for(const item of fs.readdirSync(folder,{withFileTypes:true})){
  if(['node_modules','workspace','.git','.local','__pycache__'].includes(item.name)||item.isSymbolicLink())continue;
  const target=path.join(folder,item.name);
  if(item.isDirectory())files.push(...scanFolder(target));
  else if(/\.(?:mjs|cjs|jsx?|html)$/.test(item.name))files.push(path.relative(root,target));
 }
 return files;
}
/** 检查紧邻注释或函数首部说明，不把远处模块说明算作函数注释。 */
function documented(node,parent,source){
 const leading=[...(node.leadingComments||[]),...(parent?.leadingComments||[])];
 if(leading.some(/* 检查是否至少有一项满足当前校验条件。 */ comment=>chinese.test(comment.value)&&source.slice(comment.end,node.start).trim().length<35))return true;
 const first=node.body?.body?.[0];
 return Boolean(first?.leadingComments?.some(/* 检查是否至少有一项满足当前校验条件。 */ comment=>chinese.test(comment.value)));
}
/** 生成可维护的函数清单，同时保留字节位置，供逐项复核定位。 */
export function inventory(){
 const records=[];
 for(const file of sourceFiles()){
  const full=fs.readFileSync(path.join(root,file),'utf8');
  const blocks=file.endsWith('.html')?[...full.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ match=>({source:match[1],offset:match.index+match[0].indexOf('>')+1})): [{source:full,offset:0}];
  for(const {source,offset} of blocks){
   const ast=parse(source,{sourceType:'unambiguous',plugins:['jsx'],allowReturnOutsideFunction:true});
   walk(ast,null,/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ (node,parent)=>{
    if(!kinds.has(node.type))return;
    let name=node.id?.name||node.key?.name||parent?.id?.name||parent?.key?.name;
    if(!name&&parent?.type==='AssignmentExpression')name=parent.left.property?.name||parent.left.name;
    const line=full.slice(0,offset+node.start).split('\n').length;
    records.push({file,line,start:offset+node.start,name:name||'<匿名回调>',operation:parent?.callee?.property?.name||parent?.callee?.name||parent?.type,kind:node.type,documented:documented(node,parent,source),snippet:source.slice(node.start,Math.min(node.end,node.start+100)).replace(/\s+/g,' ')});
   });
  }
 }
 return records;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const records=inventory(),missing=records.filter(/* 筛出满足当前检查条件的项，排除不适用数据。 */ record=>!record.documented);
 if(process.argv.includes('--inventory'))console.log(JSON.stringify(records,null,2));
 else{console.log(JSON.stringify({functions:records.length,missing:missing.length,items:missing},null,2));process.exitCode=missing.length?1:0;}
}
