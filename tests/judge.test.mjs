import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {judge} from '../judge/index.mjs';

test('真实 C 评测区分三种结果，并拦截外部文件引用和无限循环',async t=>{
  if(!existsSync(new URL('../judge/cases.mjs',import.meta.url)))return t.skip('缺少私有用例文件');
  try{execFileSync(process.env.JUDGE_CLANG || 'clang',['--version'],{stdio:'ignore'});}
  catch{return t.skip('缺少 Clang');}
  const directory=await mkdtemp(path.resolve('.judge-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const graph='bool HasPath(LGraph g,Vertex s,Vertex t){int queue[100]={s},seen[100]={0};int a=0,b=1;seen[s]=1;while(a<b){int v=queue[a++];if(v==t)return true;for(PtrToAdjVNode p=g->G[v].FirstEdge;p;p=p->Next){if(!seen[p->AdjV]){seen[p->AdjV]=1;queue[b++]=p->AdjV;}}}return false;}';
  const list='List Intersect(List a,List b){List h=calloc(1,sizeof(*h)),t=h;for(a=a->Next,b=b->Next;a&&b;){if(a->Data<b->Data)a=a->Next;else if(a->Data>b->Data)b=b->Next;else{t->Next=calloc(1,sizeof(*t));t=t->Next;t->Data=a->Data;a=a->Next;b=b->Next;}}return h;}';
  const tree='int Height(BiTree p){if(!p)return 0;int a=Height(p->LChild),b=Height(p->RChild);return 1+(a>b?a:b);} void Pre_BF(BiTree t){if(!t)return;printf("BF(%c)=%d\n",t->data,Height(t->LChild)-Height(t->RChild));Pre_BF(t->LChild);Pre_BF(t->RChild);}';
  // The fixture source needs a C escape sequence in its string literal.
  assert.equal(await judge('tree-balance',tree.replace('\n','\\n'),directory),'正确');
  assert.equal(await judge('list-intersection',list,directory),'正确');
  assert.equal(await judge('graph-path',graph,directory),'正确');
  assert.equal(await judge('graph-path','bool HasPath(LGraph g,Vertex s,Vertex t){return true;}',directory),'部分正确');
  assert.equal(await judge('graph-path','this does not compile',directory),'错误');
  assert.equal(await judge('graph-path','#include "/etc/passwd"\n'+graph,directory),'错误');
  assert.equal(await judge('graph-path','bool HasPath(LGraph g,Vertex s,Vertex t){for(;;){}}',directory),'错误');
});
