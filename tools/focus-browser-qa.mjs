import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'tools/qa-focus');
await mkdir(out,{recursive:true});
const temp=await mkdtemp(path.join(tmpdir(),'zhixu-focus-ui-'));
const bank=JSON.parse(await readFile(path.join(root,'dist/data/questions.json'),'utf8'));
const invite=randomBytes(16).toString('hex'),password=randomBytes(16).toString('hex');
const username='focus_'+Date.now().toString(36);
const child=spawn(process.execPath,['server.mjs'],{
  cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:temp,BASE_PATH:'',INVITE_CODE:invite,ALLOW_REGISTRATION:'true',COOKIE_SECURE:'false'},
  stdio:['ignore','pipe','pipe'],windowsHide:true,
});
let browser,pcPage,phonePage;
const checks=[],errors=[];

async function waitUntil(read,predicate,message,timeout=12000){
  const start=Date.now();
  while(Date.now()-start<timeout){const value=await read();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,80));}
  throw new Error(message);
}

try{
  const origin=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error('测试服务启动超时')),10000);
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
    child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);reject(new Error('测试服务退出 '+code));});
  });
  const modulePath=process.env.PLAYWRIGHT_MODULE || null;
  const {chromium}=await import(modulePath ? (modulePath.startsWith('file:') ? modulePath : pathToFileURL(modulePath)) : 'playwright');
  browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || undefined,headless:true});
  const pc=await browser.newContext({viewport:{width:1430,height:950},acceptDownloads:true});
  pcPage=await pc.newPage();
  pcPage.on('pageerror',error=>errors.push(error.message));
  const state=async(page=pcPage)=>{
    const response=await page.request.get(origin+'/api/progress');assert.equal(response.status(),200);
    return (await response.json()).state;
  };
  const sync=async(page=pcPage)=>page.locator('.sync-indicator.online').waitFor({timeout:15000});
  async function login(page,register=false){
    await page.goto(origin);await page.locator('[data-action="auth"]').first().click();
    if(register)await page.locator('[data-action="auth-mode"][data-mode="register"]').click();
    await page.locator('#auth-form [name="username"]').fill(username);
    await page.locator('#auth-form [name="password"]').fill(password);
    if(register)await page.locator('#auth-form [name="inviteCode"]').fill(invite);
    await page.locator('#auth-form [type="submit"]').click();await sync(page);
  }
  async function startAll(page){
    await page.goto(origin+'/#practice');
    const direct=page.locator('[data-action="start-filter"]');
    if(!await direct.first().isVisible())await page.locator('[data-action="practice-options"]').first().click();
    await page.locator('#practice-mode').selectOption('all');
    await page.locator('#practice-chapter').selectOption('all');
    if(await page.locator('#practice-topic').isVisible())await page.locator('#practice-topic').selectOption('all');
    await page.locator('[data-action="start-filter"]').first().click();
    await page.locator('.focus-question').waitFor();
  }
  async function jump(page,q){
    await page.locator('[data-action="question-map"]').click();
    await page.locator(`#modal-root [data-action="jump"][data-index="${q.number-1}"]`).click();
    await page.locator('#modal-root .modal').waitFor({state:'hidden'});
    await waitUntil(()=>page.locator('.question-number strong').textContent(),value=>value.includes(String(q.number).padStart(4,'0')),'跳题后题号没有更新');
  }
  async function geometry(page){
    return page.evaluate(()=>{
      const reader=document.querySelector('.focus-reader'),footer=document.querySelector('.focus-actions');
      const r=reader.getBoundingClientRect(),f=footer.getBoundingClientRect();
      const buttons=[...footer.querySelectorAll('button')].map(node=>({action:node.dataset.action,text:node.textContent.trim(),box:{x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}}));
      return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,scrollY,
        reader:{top:r.top,bottom:r.bottom,height:reader.clientHeight,content:reader.scrollHeight,scrollTop:reader.scrollTop},
        footer:{top:f.top,bottom:f.bottom},buttons};
    });
  }
  async function checkLayout(page,name){
    const g=await geometry(page);
    assert.ok(g.scrollWidth<=g.width+1,`${name} 横向溢出 ${JSON.stringify(g)}`);
    assert.ok(g.scrollHeight<=g.height+1,`${name} 页面整体仍上下滚动 ${JSON.stringify(g)}`);
    assert.equal(g.scrollY,0,`${name} 页面整体位置移动`);
    assert.ok(g.reader.bottom<=g.footer.top+1,`${name} 操作栏遮挡阅读区`);
    assert.ok(g.footer.bottom<=g.height+1,`${name} 操作栏超出窗口`);
    assert.deepEqual(g.buttons.map(b=>b.action),['previous','next'],`${name} 底部应只有上一题和下一题`);
    assert.equal(await page.locator('.question-map-panel:visible').count(),0);
    assert.equal(await page.locator('.sidebar:visible').count(),0);
    assert.equal(await page.locator('[data-action="submit"],[data-action="view-answer"],[data-action="retry"]').count(),0);
    return g;
  }
  async function shot(page,name){
    await page.evaluate(()=>document.activeElement?.blur());
    await page.waitForFunction(()=>document.getElementById('toast').hidden,null,{timeout:6000}).catch(()=>{});
    await page.screenshot({path:path.join(out,name+'.png')});
  }

  await login(pcPage,true);await startAll(pcPage);
  const singles=bank.questions.filter(q=>q.questionType==='single'&&q.mode==='text');
  const first=singles[0],second=singles[1];
  await jump(pcPage,first);
  const before=await checkLayout(pcPage,'1430px 专注练习');
  const stemFont=await pcPage.locator('.question-stem').evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
  const optionFont=await pcPage.locator('.option-text').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
  assert.ok(stemFont>=22&&optionFont>=20,'电脑默认题目字号应加大');
  await pcPage.locator(`[data-action="option"][data-index="${first.answer[0]}"]`).click();
  await pcPage.locator('.focus-option-zone .answer-panel.correct').waitFor();
  const after=await checkLayout(pcPage,'单击选项后');
  assert.equal(before.footer.top,after.footer.top);assert.equal(before.reader.top,after.reader.top);
  assert.deepEqual(before.buttons.map(b=>b.box),after.buttons.map(b=>b.box),'作答前后导航按钮位置变化');
  assert.ok((await pcPage.locator('.focus-option-zone .answer-panel').textContent()).includes(first.explanation));
  assert.equal(await pcPage.locator('.option-button').first().evaluate(node=>getComputedStyle(node).opacity),'1','判分后选项不应整体变浅');
  assert.ok(await pcPage.locator('.answer-explanation').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))>=18,'电脑解析字号不应小于18px');
  const saved=await waitUntil(state,s=>s.records[first.id]?.lastCorrect===true,'单击正确选项后记录未保存');
  assert.equal(saved.records[first.id].attempts,1);
  await pcPage.locator(`[data-action="option"][data-index="${first.answer[0]}"]`).dispatchEvent('click');
  await sync();assert.equal((await state()).records[first.id].attempts,1,'重复点击不应反复计数');
  await pcPage.locator('.answer-panel').screenshot({path:path.join(out,'inline-analysis.png')});
  await pcPage.locator('.focus-reader').evaluate(node=>node.scrollTop=0);await shot(pcPage,'desktop-focus');
  checks.push('PC专注布局无侧栏或右侧解析栏，默认大字，点击单选立即判分且解析位于选项区');
  checks.push('底部仅上一题和下一题，提交前后按钮位置不变且不遮挡阅读区');

  await jump(pcPage,second);
  await pcPage.locator(`[data-action="option"][data-index="${(second.answer[0]+1)%second.options.length}"]`).click();
  await pcPage.locator('.answer-panel.incorrect').waitFor();
  await waitUntil(state,s=>s.records[second.id]?.lastCorrect===false,'错误选择未写入错题');
  await pcPage.locator('[data-action="next"]').click();await pcPage.locator('[data-action="previous"]').click();
  assert.equal(await pcPage.locator('.answer-panel.incorrect').count(),1,'返回上一题应保留已作答和解析');
  assert.equal(await pcPage.locator('.option-button.selected').count(),1);
  checks.push('单击错误选项自动进入错题，上一题/下一题保留作答状态');

  const scan=bank.questions.find(q=>q.mode==='scan'&&q.questionType==='single');
  await jump(pcPage,scan);
  await pcPage.locator(`[data-action="option"][data-index="${scan.answer[0]}"]`).click();
  await pcPage.locator('.answer-panel.correct').waitFor();
  await waitUntil(state,s=>s.records[scan.id]?.lastCorrect===true,'原图题未自动保存');
  checks.push('原图题同样支持直接点选判分和内联解析');

  const multiple=bank.questions.find(q=>q.questionType==='multiple');assert.ok(multiple);
  await jump(pcPage,multiple);
  for(const i of multiple.answer)await pcPage.locator(`[data-action="option"][data-index="${i}"]`).click();
  assert.equal(await pcPage.locator('.answer-panel.correct').count(),1);
  assert.equal((await state()).records[multiple.id],undefined,'多选未离开本题前不应按每次勾选重复计次');
  await pcPage.locator('[data-action="next"]').click();
  const multiState=await waitUntil(state,s=>s.records[multiple.id]?.lastCorrect===true,'多选离题后未保存完整结果');
  assert.equal(multiState.records[multiple.id].attempts,1);
  checks.push('多选可连续勾选并预览解析，离开本题时只记录一次最终结果');

  const ordered=bank.questions.find(q=>q.questionType==='ordered');assert.ok(ordered);
  await jump(pcPage,ordered);
  for(let slot=0;slot<ordered.answer.length;slot++)await pcPage.locator(`[data-answer-slot="${slot}"]`).selectOption(String(ordered.answer[slot]));
  await pcPage.locator('.answer-panel.correct').waitFor();
  await pcPage.locator('[data-action="next"]').click();
  const orderedState=await waitUntil(state,s=>s.records[ordered.id]?.lastCorrect===true,'顺序填空结果未保存');
  assert.equal(orderedState.records[ordered.id].attempts,1);assert.deepEqual(orderedState.records[ordered.id].lastAnswer,ordered.answer);
  checks.push('顺序填空填完即可判分，离题保存正确空位顺序');

  const invalid=bank.questions.find(q=>q.questionType==='invalid');assert.ok(invalid);
  await jump(pcPage,invalid);
  await pcPage.locator('.answer-panel').waitFor();
  assert.ok((await pcPage.locator('.answer-panel').textContent()).includes(invalid.referenceAnswer));
  assert.equal((await state()).records[invalid.id],undefined);
  checks.push('原题问题自动展示参考结论，无额外按钮且不强行判分');

  const longest=[...singles].sort((a,b)=>(b.stem.length+b.options.join('').length)-(a.stem.length+a.options.join('').length))[0];
  await jump(pcPage,longest);await pcPage.locator('#practice-font').selectOption('large');
  for(const [width,height,name] of [[1366,768,'desktop-1366'],[1093,614,'desktop-125percent']]){
    await pcPage.setViewportSize({width,height});
    const g=await checkLayout(pcPage,name);
    assert.ok(g.reader.content>g.reader.height,`${name} 长题应在阅读区滚动`);
    await pcPage.locator('.option-button').last().scrollIntoViewIfNeeded();
    const reader=await pcPage.locator('.focus-reader').boundingBox(),last=await pcPage.locator('.option-button').last().boundingBox();
    assert.ok(last.y+last.height<=reader.y+reader.height+1,'最后一个选项应能完整滚动到操作栏之上');
    await shot(pcPage,name);
  }
  checks.push('1366×768和125%缩放等效窗口内仅阅读区滚动，放大字号后操作栏仍固定');

  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  phonePage=await mobile.newPage();phonePage.on('pageerror',error=>errors.push(error.message));
  await login(phonePage);
  assert.equal((await state(phonePage)).records[first.id].lastCorrect,true);
  await phonePage.goto(origin+'/#practice');await phonePage.locator('.focus-question').waitFor();
  await jump(phonePage,first);
  for(const width of [390,320]){
    await phonePage.setViewportSize({width,height:844});
    await checkLayout(phonePage,`手机 ${width}px`);
    await phonePage.locator('.focus-reader').evaluate(node=>node.scrollTop=0);
    await shot(phonePage,`mobile-${width}-focus`);
  }
  checks.push('手机390/320px同样无遮挡、无整页滚动，并同步电脑作答记录');
  assert.deepEqual(errors,[]);
  const report={passed:true,checks,browserErrors:errors};
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  await pcPage?.screenshot({path:path.join(out,'desktop-failure.png')}).catch(()=>{});
  await phonePage?.screenshot({path:path.join(out,'mobile-failure.png')}).catch(()=>{});
  await writeFile(path.join(out,'failure.json'),JSON.stringify({error:error.message,checks,browserErrors:errors},null,2));
  throw error;
}finally{
  await browser?.close();
  if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}
  const resolved=path.resolve(temp);
  if(!resolved.startsWith(path.resolve(tmpdir())+path.sep)||!path.basename(resolved).startsWith('zhixu-focus-ui-'))throw new Error('拒绝清理非测试目录');
  await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
