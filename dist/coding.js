let userId, selected;
const submissions=new Map();

function reset(account){
  if(userId===account.user?.id)return;
  userId=account.user?.id;
  selected=null;
  submissions.clear();
}

export function codingPage(account,problems,escape){
  reset(account);
  if(!account.user)return `<section class="settings-card"><h2>编程练习</h2><p>登录后可查看你有权访问的编程题。</p><button class="button primary" data-action="auth">登录 / 注册</button></section>`;
  if(!problems.length)return '<section class="settings-card"><h2>编程练习</h2><p>当前科目暂无编程题。</p></section>';
  const problem=problems.find(item=>item.id===selected) || problems[0];
  selected=problem.id;
  const submission=submissions.get(selected);
  const options=problems.map(item=>`<option value="${escape(item.id)}" ${item.id===selected?'selected':''}>${escape(item.category)} · ${escape(item.title)}</option>`).join('');
  return `<section class="settings-card coding-card">
    <h2>编程练习</h2>
    <label for="coding-problem">按类别选题</label>
    <select class="select" id="coding-problem">${options}</select>
    <h3>${escape(problem.title)}</h3>
    <p>${escape(problem.statement)}</p>
    <details open><summary>系统已提供的类型与接口</summary><pre>${escape(problem.types)}</pre></details>
    <details><summary>公开样例</summary><strong>输入</strong><pre>${escape(problem.sampleInput)}</pre><strong>输出</strong><pre>${escape(problem.sampleOutput)}</pre></details>
    <form id="coding-form">
      <label for="coding-source">C 语言答案（只提交要求的函数，可附加辅助函数）</label>
      <textarea id="coding-source" name="source" rows="12" maxlength="32768" spellcheck="false" required>${escape(submission?.source ?? problem.starter)}</textarea>
      <button class="button primary" type="submit" ${submission?.pending?'disabled':''}>${submission?.pending?'评测中…':'提交评测'}</button>
      <strong id="coding-result" role="status">${escape(submission?.result || '')}</strong>
    </form>
  </section>`;
}

export function selectCodingProblem(id){selected=id;}

export function saveCodingDraft(source){
  if(!selected)return;
  const submission=submissions.get(selected) || {};
  submission.source=source;
  submissions.set(selected,submission);
}

export async function submitCoding(account,source,render,toast){
  if(!account.user || !selected)return;
  const id=selected;
  const submission=submissions.get(id) || {};
  if(submission.pending)return;
  Object.assign(submission,{source,pending:true,result:''});
  submissions.set(id,submission);
  render();
  try{
    const {result}=await account.api('/coding/submit','POST',{id,source});
    submission.result=result;
  }catch(error){
    toast(error.message);
  }finally{
    submission.pending=false;
    render();
  }
}
