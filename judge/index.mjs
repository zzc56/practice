import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {Worker} from 'node:worker_threads';
import {problems} from './problems.mjs';

const runCompiler=promisify(execFile);
const {cases}=await import('./cases.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {cases:null};
  throw error;
});
const runtime=await readFile(new URL('./runtime.c',import.meta.url),'utf8');
const harnesses=new Map(await Promise.all([...problems.keys()].map(async id=>[
  id,await readFile(new URL('./'+id+'.c',import.meta.url),'utf8')
])));
let active=0;

function sanitize(source){
  // Build a freestanding C translation unit without user-controlled file directives
  // or inline assembly. The limited standard headers are supplied by runtime.c.
  if(/\\[ \t]*(?:\r\n|\r|\n)|\?\?|\0/.test(source))return null;
  const code=source.replace(/^[ \t]*#[ \t]*include[ \t]*<(?:stdio|stdlib|stdbool|stddef)\.h>[ \t]*(?=\r?$)/gm,'');
  const tokens=code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\[^\r\n]|[^"\\\r\n])*"|'(?:\\[^\r\n]|[^'\\\r\n])*'/g,' ');
  if(/#|%:|\\|\b(?:asm|__\w*)\b/.test(tokens))return null;
  return code;
}

function runCase(wasm,[input,expected]){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./worker.mjs',import.meta.url),{
      workerData:{wasm,input,expected},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:32,stackSizeMb:2}
    });
    const timer=setTimeout(()=>{void worker.terminate();resolve(false);},750);
    worker.once('message',passed=>{clearTimeout(timer);void worker.terminate();resolve(passed===true);});
    worker.once('error',error=>{clearTimeout(timer);reject(error);});
    worker.once('exit',()=>{clearTimeout(timer);resolve(false);});
  });
}

export async function judge(id,source,dataDirectory){
  const problem=problems.get(id);
  const fixtures=cases?.get(id);
  if(!fixtures?.length)throw Object.assign(new Error('尚未配置本题的评测用例'),{status:503});
  const code=sanitize(source);
  if(code===null)return '错误';
  if(active>=2)throw Object.assign(new Error('评测繁忙，请稍后再试'),{status:429});
  active++;
  let folder;
  try{
    folder=await mkdtemp(path.resolve(dataDirectory,'zhixu-judge-'));
    await writeFile(path.join(folder,'submission.c'),[runtime,problem.types,code,harnesses.get(id)].join('\n'));
    try{
      const environment={TEMP:folder,TMP:folder,TMPDIR:folder};
      for(const key of ['PATH','SystemRoot','WINDIR','PATHEXT']){
        if(process.env[key])environment[key]=process.env[key];
      }
      await runCompiler(process.env.JUDGE_CLANG || 'clang',[
        '--target=wasm32','-std=c11','-pedantic-errors','-fno-builtin','-nostdinc','-nostdlib',
        '-Wl,--no-entry','-Wl,--export=run','-Wl,--allow-undefined',
        '-Wl,--initial-memory=8388608','-Wl,--max-memory=8388608','-Wl,--strip-all',
        'submission.c','-o','submission.wasm'
      ],{cwd:folder,env:environment,timeout:5000,maxBuffer:32768,windowsHide:true});
    }catch(error){
      if(error.code==='ENOENT')throw Object.assign(new Error('本机尚未安装评测所需的 Clang'),{status:503});
      return '错误';
    }
    const wasm=await readFile(path.join(folder,'submission.wasm'));
    let passed=0;
    for(const fixture of fixtures)if(await runCase(wasm,fixture))passed++;
    return passed===fixtures.length?'正确':passed?'部分正确':'错误';
  }finally{
    active--;
    if(folder)await rm(folder,{recursive:true,force:true}).catch(()=>{});
  }
}
