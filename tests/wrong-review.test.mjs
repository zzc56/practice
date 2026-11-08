import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createState,recordAnswer,toggleFavorite,dismissWrongAnswers,selectQuestions,getStats,getQuestionStatus,normalizeState,exportBackup,importBackup} from '../dist/core.js';

const questions=[{id:'a',chapter:'basics',stem:'A'},{id:'b',chapter:'basics',stem:'B'}];
const time='2026-11-01T10:00:00.000Z';
function seed(){return toggleFavorite(recordAnswer(recordAnswer(createState(),'a',false,{now:time}),'b',false,{now:time}),'a');}
test('移出单题只清理错题列表，保留错误、统计、收藏、设置与原状态',()=>{
  const state=seed(),before=JSON.stringify(state);
  const result=dismissWrongAnswers(state,[{questionId:'a',lastAt:time}]);
  assert.equal(JSON.stringify(state),before);
  assert.equal(result.records.a.lastCorrect,false);
  assert.equal(result.records.a.attempts,1);assert.equal(result.records.a.wrongCount,1);assert.equal(result.records.a.correctCount,0);
  assert.deepEqual(result.daily,state.daily);assert.deepEqual(result.favorites,state.favorites);assert.deepEqual(result.settings,state.settings);
  assert.deepEqual(selectQuestions(questions,{mode:'wrong'},result).map(q=>q.id),['b']);
  assert.equal(getStats(questions,result).wrong,1);assert.equal(getStats(questions,result).mastered,0);assert.equal(getStats(questions,result).answered,2);
  assert.equal(getQuestionStatus(result,'a'),'reviewed');
});
test('清空全部错题后，重新答错仍自动加入',()=>{
  const state=seed(),cleared=dismissWrongAnswers(state,questions.map(q=>({questionId:q.id,lastAt:time})));
  assert.equal(getStats(questions,cleared).wrong,0);assert.equal(getStats(questions,cleared).attempts,2);
  const wrongAgain=recordAnswer(cleared,'a',false,{now:time});
  assert.deepEqual(selectQuestions(questions,{mode:'wrong'},wrongAgain).map(q=>q.id),['a']);
  assert.equal(wrongAgain.records.a.wrongCount,2);assert.deepEqual(wrongAgain.favorites,['a']);
});
test('清理状态在旧数据兼容、备份导入和重载后保留；过期清理不影响新错误',()=>{
  const state=seed(),cleared=dismissWrongAnswers(state,[{questionId:'a',lastAt:time}]);
  const restored=importBackup(exportBackup(cleared),['a','b']);
  assert.equal(restored.records.a.wrongDismissed,true);assert.equal(getStats(questions,restored).wrong,1);
  assert.equal(normalizeState(state,['a','b']).records.a.wrongDismissed,false);
  const newer=recordAnswer(cleared,'a',false,{now:'2026-11-01T10:01:00.000Z'});
  assert.equal(dismissWrongAnswers(newer,[{questionId:'a',lastAt:time}]),newer);
  assert.equal(getQuestionStatus(newer,'a'),'wrong');
});

test('错题清理跨会话同步、账号隔离、重试幂等及旧离线作答保护',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const directory=await mkdtemp(path.join(tmpdir(),'zhixu-wrong-review-'));
  const invite='wrong-review-test-invite';
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:directory,BASE_PATH:'',INVITE_CODE:invite,ALLOW_REGISTRATION:'true',COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});
  try{
    const origin=await new Promise((resolve,reject)=>{
      let log='';const timeout=setTimeout(()=>reject(new Error('测试服务启动超时')),10000);
      child.stdout.on('data',chunk=>{log+=chunk;const found=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(found){clearTimeout(timeout);resolve(found[0]);}});
      child.on('error',reject);child.on('exit',code=>{clearTimeout(timeout);reject(new Error('服务退出 '+code));});
    });
    const call=async(route,cookie='',input)=>{
      const response=await fetch(origin+route,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Requested-With':'zhixu',...(cookie?{Cookie:cookie}:{})},...(input===undefined?{}:{body:JSON.stringify(input)})});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0] || ''};
    };
    const credentials={username:'wrong_review_user',password:'Wrong-Review-Password',inviteCode:invite};
    const first=await call('/api/auth/register','',credentials),second=await call('/api/auth/login','',credentials);
    assert.equal(first.status,201);assert.equal(second.status,200);
    const isolated=await call('/api/auth/register','',{...credentials,username:'other_review_user'});
    const bank=(await (await fetch(origin+'/data/questions.json')).json()).questions;
    const [a,b]=bank;
    const t0=new Date(Date.now()-60000).toISOString(),t1=new Date(Date.now()-50000).toISOString(),t2=new Date(Date.now()-10000).toISOString();
    const write=(cookie,events)=>call('/api/progress/events',cookie,{events});
    const initial=await write(first.cookie,[
      {id:'wrong-test-seed-1',type:'answer',questionId:a.id,correct:false,occurredAt:t0},
      {id:'wrong-test-seed-2',type:'answer',questionId:b.id,correct:false,occurredAt:t1},
      {id:'wrong-test-star-1',type:'favorite',questionId:a.id,value:true},
      {id:'wrong-test-settings',type:'settings',settings:{fontSize:'large',showSource:false,autoNext:true}},
    ]);
    const event={id:'wrong-test-dismiss-one',type:'dismiss-wrong',targets:[{questionId:a.id,lastAt:t0}]};
    assert.equal((await call('/api/progress/events','',{events:[event]})).status,401);
    const cleared=await write(second.cookie,[event]);assert.equal(cleared.status,200);
    const received=await call('/api/progress',first.cookie);
    assert.equal(received.data.state.records[a.id].wrongDismissed,true);
    assert.equal(received.data.state.records[a.id].lastCorrect,false);
    assert.deepEqual(received.data.state.daily,initial.data.state.daily);
    assert.deepEqual(received.data.state.settings,initial.data.state.settings);
    assert.deepEqual(received.data.state.favorites,[a.id]);
    assert.equal((await write(first.cookie,[event])).data.revision,cleared.data.revision);
    assert.deepEqual((await call('/api/progress',isolated.cookie)).data.state.records,{});
    const all=await write(first.cookie,[{id:'wrong-test-dismiss-all',type:'dismiss-wrong',targets:[{questionId:b.id,lastAt:t1}]}]);
    assert.equal(getStats(bank,all.data.state).wrong,0);
    const old=await write(second.cookie,[{id:'wrong-test-old-offline',type:'answer',questionId:a.id,correct:false,occurredAt:new Date(Date.now()-120000).toISOString()}]);
    assert.equal(old.data.state.records[a.id].wrongDismissed,true);assert.equal(old.data.state.records[a.id].attempts,2);
    const fresh=await write(second.cookie,[{id:'wrong-test-new-attempt',type:'answer',questionId:a.id,correct:false,occurredAt:t2}]);
    assert.equal(getStats(bank,fresh.data.state).wrong,1);
    const stale=await write(first.cookie,[{id:'wrong-test-stale-dismiss',type:'dismiss-wrong',targets:[{questionId:a.id,lastAt:t0}]}]);
    assert.equal(getStats(bank,stale.data.state).wrong,1);
    assert.equal((await write(first.cookie,[{id:'wrong-test-invalid-id',type:'dismiss-wrong',targets:[{questionId:'not-in-bank',lastAt:t0}]}])).status,400);
  }finally{
    if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}
    const resolved=path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep) && path.basename(resolved).startsWith('zhixu-wrong-review-'));
    await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
