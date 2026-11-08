import {evaluateAnswer,referenceLabel,getStats,selectQuestions,getQuestionStatus,shuffle,exportBackup,isWrongRecord} from './core.js';
import {LearningAccount} from './account.js';

const $=s=>document.querySelector(s);
const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',play:'m9 5 11 7-11 7z',wrong:'M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4M9 2h6v4H9zm0 9 6 6m0-6-6 6',star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',book:'M12 5c-3-3-7-2-10-2v16c4 0 7-1 10 2m0-16c3-3 7-2 10-2v16c-4 0-7-1-10 2zm0 0v16',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm-7-1 2-2 3 1 1-3h2l1 3 3-1 2 2-1 3 3 1v2l-3 1 1 3-2 2-3-1-1 3h-2l-1-3-3 1-2-2 1-3-3-1v-2l3-1z',arrow:'M5 12h14m-6-6 6 6-6 6',chevron:'m9 5 7 7-7 7',check:'m5 12 4 4L19 6',close:'m6 6 12 12M18 6 6 18',menu:'M4 6h16M4 12h16M4 18h16',search:'M21 21l-5-5m2-6a8 8 0 1 1-16 0 8 8 0 0 1 16 0',shuffle:'m17 3 4 4-4 4M3 7h3c6 0 6 10 12 10h3m-4 4 4-4-4-4M3 17h3c2 0 3-2 4-4m4-2c1-2 2-4 4-4h3',chart:'M4 20V10m8 10V4m8 16v-7',clock:'M12 8v5l3 2m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0',cloud:'M6 18a5 5 0 1 1 0-10 7 7 0 0 1 13-1 5 5 0 0 1 0 11M12 11v10m-3-3 3 3 3-3',user:'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2m12-15a4 4 0 1 1-8 0 4 4 0 0 1 8 0',download:'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',upload:'M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5',zoom:'M21 21l-5-5m2-6a8 8 0 1 1-16 0 8 8 0 0 1 16 0M10 6v8m-4-4h8',list:'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1',tree:'M12 3v6M5 15V9h14v6M2 15h6v6H2zm14 0h6v6h-6zm-7-14h6v4H9z',grid:'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',graph:'M6 6l12 2m-12-2 5 13m7-11-7 11M3 3h6v6H3zm12 2h6v6h-6zM8 16h6v6H8z',layers:'m12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5',sort:'M4 5h16M4 12h11M4 19h6m9-8v10m-3-3 3 3 3-3',code:'m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',info:'M12 11v6m0-10h.01m9 5a9 9 0 1 1-18 0 9 9 0 0 1 18 0'};
const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.book}"/></svg>`;
const chapterMeta={basics:['code','理解结构，掌握算法的基本语言'],lists:['list','从顺序存储到链式存储'],stacks:['layers','后进先出与先进先出的应用'],strings:['grid','串匹配、矩阵与广义表'],trees:['tree','遍历、哈夫曼编码与树的转换'],graphs:['graph','从遍历到最短路径与关键路径'],search:['search','折半查找、平衡树与散列表'],sort:['sort','比较经典排序的过程与性能']};
const modeNames={all:'顺序练习',random:'随机练习',wrong:'错题重练',favorites:'收藏练习',unanswered:'未做题目',auto:'可自动判分题'};
const navItems=[['home','home','学习概览'],['practice','play','开始练习'],['wrong','wrong','错题本'],['favorites','star','我的收藏'],['library','book','全部题库']];
let bank,questions,byId,account,state,view='home',menuOpen=false;
let filter={mode:'all',chapter:'all',topic:'all',query:''};
let libraryFilter={mode:'all',chapter:'all',topic:'all',query:''},libraryPage=1;
let round=new Map(),sessionAnswered=new Set(),sessionCorrect=0,toastTimer,authMode='login',afterLogin=null,modalReturn=null;
let imageZoom=1;
let pendingWrongTargets=[];
let initialized=false;

function toast(message){const focusStatus=$('.focus-live-status');if(view==='practice'&&focusStatus){focusStatus.textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{if(focusStatus.isConnected)focusStatus.textContent='';},3800);return;}$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('#toast').hidden=true;},3800);}
function chapterName(id){return bank.chapters.find(c=>c.id===id)?.title || '全部章节';}
function navigate(next){menuOpen=false;if(location.hash==='#'+next){view=next;render();}else location.hash=next;}
function stats(){return getStats(questions,state);}
function logged(action){if(!account.user || account.status==='expired'){afterLogin=action;showAuth();return false;}return true;}
function saveSession(session){account.update({type:'session',session});}
function draftKey(){return 'zhixu-focus-draft:'+new URL('.',document.baseURI).pathname+':'+(account?.user?.id || 'guest');}
function draftSession(){return state.session?.startedAt || (state.session?.ids[0]+':'+state.session?.ids.length);}
function saveDraft(q,a){if(!account.user)return;try{localStorage.setItem(draftKey(),JSON.stringify({session:draftSession(),id:q.id,selected:a.selected}));}catch{}}
function removeDraft(id){try{const saved=JSON.parse(localStorage.getItem(draftKey()) || 'null');if(saved?.id===id)localStorage.removeItem(draftKey());}catch{}}
function isComplete(q,a){return q.questionType!=='invalid'&&a.selected.length>0&&(q.questionType!=='ordered'||(a.selected.length===q.answer.length&&a.selected.every(x=>Number.isInteger(x)&&x>=0)));}
function qState(id){
  if(!round.has(id)){
    const q=byId.get(id),a={selected:[],revealed:q.questionType==='invalid',graded:false,correct:null,dirty:false};
    const record=state.records[id];
    if(q.questionType!=='invalid'&&record?.grading==='auto'&&state.session?.startedAt&&Date.parse(record.lastAt)>=Date.parse(state.session.startedAt)){
      a.selected=[...record.lastAnswer];a.revealed=true;a.graded=true;a.correct=record.lastCorrect;
    }
    if(!a.graded){try{const saved=JSON.parse(localStorage.getItem(draftKey()) || 'null');if(saved?.session===draftSession()&&saved.id===id&&Array.isArray(saved.selected)){a.selected=saved.selected.filter(x=>Number.isInteger(x)&&x>=-1&&x<q.options.length);a.revealed=isComplete(q,a);a.correct=a.revealed?evaluateAnswer(q,a.selected):null;a.dirty=true;}}catch{}}
    round.set(id,a);
  }
  return round.get(id);
}
function currentQuestion(){return state.session && byId.get(state.session.ids[state.session.index]);}
function label(n){return String(n).padStart(4,'0');}
function syncBadge(){
  if(!account.user)return `<button class="button secondary small" data-action="auth">${icon('user')}登录 / 注册</button>`;
  const titles={online:'已同步',syncing:'同步中',offline:'待联网同步',expired:'登录已过期',loading:'连接中'};
  return `<button class="account-badge" data-action="sync" title="立即同步账号进度">${icon('cloud')}<span class="account-name">${escape(account.user.username)}</span><span class="sync-indicator ${account.status==='online'?'online':'offline'}">${escape(titles[account.status] || '待同步')}${account.queue.length?` · ${account.queue.length}`:''}</span></button>`;
}
function render(){
  if(!bank || !state)return;
  account.keepSession=view==='practice';
  document.body.dataset.view=view;
  const oldReader=$('.focus-reader'),readerId=oldReader?.dataset.questionId,readerScroll=oldReader?.scrollTop || 0;
  if(view==='practice')$('#toast').hidden=true;
  const focus=document.activeElement,focusId=focus?.id,selection=focus?.selectionStart;
  const titles={home:'学习概览',practice:'开始练习',wrong:'错题本',favorites:'我的收藏',library:'全部题库',settings:'学习设置'};
  const s=stats();
  document.documentElement.dataset.font=state.settings.fontSize;
  $('#app').innerHTML=`<div class="app-shell">
    ${menuOpen?'<button class="sidebar-backdrop" aria-label="关闭导航菜单" data-action="close-menu"></button>':''}
    <aside class="sidebar ${menuOpen?'mobile-open':''}" aria-label="主导航">
      <a class="brand" href="#home"><span class="brand-icon">${icon('book')}</span><span class="brand-copy"><strong>知序</strong><span>数据结构刷题</span></span></a>
      <nav class="nav-list">${navItems.map(([id,i,t])=>`<a href="#${id}" class="nav-item ${view===id?'active':''}" ${view===id?'aria-current="page"':''}>${icon(i,'nav-icon')}<span class="nav-label">${t}</span>${id==='wrong'&&s.wrong?`<span class="nav-count">${s.wrong}</span>`:''}${id==='favorites'&&s.favorite?`<span class="nav-count">${s.favorite}</span>`:''}</a>`).join('')}</nav>
      <div class="sidebar-section"><p class="sidebar-label">知识地图 <span>08</span></p>${bank.chapters.map((c,i)=>`<button class="chapter-link ${view==='practice'&&state.session?.chapter===c.id?'active':''}" data-action="chapter" data-id="${c.id}"><span class="chapter-order">${String(i+1).padStart(2,'0')}</span><span>${escape(c.title)}</span><small>${c.count}</small></button>`).join('')}</div>
      <div class="sidebar-footer"><div class="sidebar-progress"><span>整体学习进度</span><strong>${s.completion}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${s.completion}%"></div></div><p>已练习 ${s.answered} / ${s.total} 道题</p><a href="#settings" class="nav-item ${view==='settings'?'active':''}">${icon('settings')}<span>学习设置</span></a></div>
    </aside>
    <div class="main-area"><header class="topbar">${view==='practice'?`<a class="focus-topbar-brand" href="#home" aria-label="退出练习，返回学习概览"><span class="brand-icon">${icon('book')}</span><strong>知序</strong><span>专注练习</span></a>`:`<button class="mobile-menu icon-button" data-action="menu" aria-label="打开导航菜单" aria-expanded="${menuOpen}">${icon('menu')}</button><div class="breadcrumb">数据结构 <span>/</span> <strong>${titles[view] || '学习概览'}</strong></div>`}<div class="topbar-actions">${syncBadge()}<button class="icon-button" data-action="settings" title="学习设置" aria-label="学习设置">${icon('settings')}</button></div></header>
    <main id="content" class="page-content" tabindex="-1">${view==='practice'?practice():view==='wrong'?collection('wrong'):view==='favorites'?collection('favorites'):view==='library'?library():view==='settings'?settings():home()}</main>
    <footer class="site-footer">知序 · 把知识连成体系 <span>${bank.total} 道题 · 8 个知识模块</span></footer></div>
    <nav class="bottom-nav" aria-label="移动端快捷导航">${navItems.slice(0,4).map(([id,i,t])=>`<a href="#${id}" class="bottom-nav-item ${view===id?'active':''}" ${view===id?'aria-current="page"':''}>${icon(i)}<span>${id==='home'?'概览':id==='practice'?'练习':id==='favorites'?'收藏':'错题'}</span></a>`).join('')}</nav></div>`;
  const newReader=$('.focus-reader');if(newReader&&newReader.dataset.questionId===readerId)newReader.scrollTop=readerScroll;
  if(focusId){const next=document.getElementById(focusId);if(next){next.focus({preventScroll:true});if(typeof next.setSelectionRange==='function'&&Number.isInteger(selection))try{next.setSelectionRange(selection,selection);}catch{}}}
}
function heading(eyebrow,title,description,extra=''){return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1 class="page-title">${title}</h1><p class="page-description">${description}</p></div>${extra}</div>`;}
function home(){
  const s=stats(),session=state.session;
  return `${heading('LEARN WITH STRUCTURE','每一道题，都让知识更清晰。','从一个知识点开始，循序渐进，建立你的数据结构知识体系。')}
  <section class="hero-card"><div class="hero-copy"><span class="hero-kicker"><span class="status-dot"></span> 你的数据结构练习空间</span><h2 class="hero-title">把零散的知识，<br>连成清晰的思路。</h2><p class="hero-description">533 道精选选择题，覆盖 8 大知识模块。<br>按章节巩固，在错题中找到下一步。</p><div class="hero-actions"><button class="button hero-primary" data-action="daily">开始今日练习 ${icon('arrow')}</button><button class="button hero-secondary" data-action="browse">浏览全部题库 ${icon('chevron')}</button></div><div class="hero-note">${icon('check')}账号同步进度 <span>·</span> 电脑手机随时接着练</div></div><div class="hero-art" aria-hidden="true"><div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div><div class="art-node node-main">${icon('tree')}</div><div class="art-node node-one">${icon('code')}</div><div class="art-node node-two">${icon('graph')}</div><div class="art-node node-three">${icon('layers')}</div><div class="art-chip"><span class="status-dot"></span> 少一点死记，多一点理解</div></div></section>
  <section class="stats-grid" aria-label="学习数据">${[[s.total,'题库总量','book','覆盖完整知识体系'],[s.answered,'已练习题目','check',`${s.completion}% 的题目已练习`],[s.wrong,'待复习错题','wrong','及时回顾，巩固薄弱点'],[s.streak,'连续学习天数','clock',s.today?`今天已练习 ${s.today} 次`:'今天也来进步一点']].map(([value,text,i,sub])=>`<div class="stat-card"><div class="stat-top"><span class="stat-label">${text}</span><span class="stat-icon ${i}">${icon(i)}</span></div><div class="stat-value">${value}<small>${i==='clock'?'天':'题'}</small></div><p class="stat-caption">${sub}</p></div>`).join('')}</section>
  ${session?`<div class="session-banner"><span>${icon('play')}<span>继续上次练习 <strong>${escape(chapterName(session.chapter))}</strong> · 第 ${session.index+1} / ${session.ids.length} 题</span></span><button class="text-link" data-action="continue">继续练习 ${icon('arrow')}</button></div>`:''}
  <section><div class="section-heading"><div><p class="eyebrow">KNOWLEDGE MAP</p><h2 class="section-title">按知识点，稳步进阶</h2></div><button class="text-link" data-action="random">随机挑战 ${icon('shuffle')}</button></div><div class="chapter-grid">${bank.chapters.map((c,index)=>{
    const group=questions.filter(q=>q.chapter===c.id),cs=getStats(group,state),[i,desc]=chapterMeta[c.id];
    return `<button class="chapter-card" data-action="chapter" data-id="${c.id}"><div class="chapter-card-top"><span class="chapter-icon color-${index%4}">${icon(i)}</span><span class="chapter-index">CHAPTER ${String(index+1).padStart(2,'0')}</span>${icon('arrow','chapter-arrow')}</div><div class="chapter-meta"><h3 class="chapter-title">${escape(c.title)}</h3><p class="chapter-description">${desc}</p></div><div class="progress-track"><div class="progress-fill" style="width:${cs.completion}%"></div></div><div class="chapter-footer"><span>${c.count} 道题 <span class="divider">/</span> ${new Set(group.map(q=>q.topic)).size} 个知识点</span><span>已练习 ${cs.answered} 题</span></div></button>`;
  }).join('')}</div></section>
  <div class="notice home-notice">${icon('info')}<p>全部 ${questions.length} 道题提供参考结论与解析。正常题目点选后自动判分；原题有歧义或选项错误的题目会具体说明原因。</p></div>`;
}
function chapterSelect(value,id='practice-chapter'){return `<select id="${id}" class="select" aria-label="知识模块"><option value="all">全部知识模块</option>${bank.chapters.map(c=>`<option value="${c.id}" ${value===c.id?'selected':''}>${escape(c.title)} · ${c.count} 题</option>`).join('')}</select>`;}
function modeSelect(value,id='practice-mode'){return `<select id="${id}" class="select" aria-label="练习模式">${Object.entries(modeNames).map(([v,t])=>`<option value="${v}" ${value===v?'selected':''}>${t}</option>`).join('')}</select>`;}
function topicSelect(chapter,value,id){const list=[...new Set(questions.filter(q=>chapter==='all'||q.chapter===chapter).map(q=>q.topic))];return `<select id="${id}" class="select" aria-label="知识点"><option value="all">全部知识点</option>${list.map(t=>`<option value="${escape(t)}" ${value===t?'selected':''}>${escape(t)}</option>`).join('')}</select>`;}
function practice(){
  const session=state.session,q=currentQuestion();
  if(!session||!q)return `<section class="focus-workspace focus-empty-workspace"><div class="focus-toolbar"><div class="focus-session-info"><strong>专注练习</strong><span>选择知识点开始</span></div><button class="focus-tool-button" data-action="exit-practice" aria-label="返回概览">${icon('close')}<span>退出练习</span></button></div><div class="focus-reader"><div class="focus-filter-panel">${heading('FOCUS & PRACTICE','准备好，开始练习','点击选项即可作答，参考解析直接显示在选项下方。')}<div class="filter-bar">${modeSelect(filter.mode)}${chapterSelect(filter.chapter)}${topicSelect(filter.chapter,filter.topic,'practice-topic')}<button class="button primary" data-action="start-filter">${icon('play')}开始练习</button></div><button class="button secondary" data-action="daily">20 题随机练习</button></div></div><div class="focus-actions"><button class="button secondary" disabled>上一题</button><span class="focus-navigation-status">请先选择题组</span><button class="button primary" disabled>下一题</button></div></section>`;
  const a=qState(q.id),ordered=q.questionType==='ordered',invalid=q.questionType==='invalid',multi=!ordered&&(q.questionType==='multiple'||q.answer?.length>1),hasAnswer=!!q.answer?.length&&!invalid;
  const selected=a.selected;
  const stem=q.mode==='text'?`<div class="question-stem">${escape(q.stem)}</div>`:`<p class="focus-scan-hint">${icon('info')}按原图顺序选择 A、B、C、D。题图可点击放大。</p>${q.stem&&q.stem!=='原题图示'?`<div class="question-stem">${escape(q.stem)}</div>`:''}<div class="scan-images">${q.images.map((src,i)=>`<button class="scan-image-button" data-action="image" data-src="${escape(src)}" aria-label="放大第 ${i+1} 张题图"><img class="scan-image" src="${escape(src)}" alt="第 ${q.number} 题原始题图 ${i+1}" loading="lazy"><span>${icon('zoom')}放大题图</span></button>`).join('')}</div>`;
  let options='';
  if(ordered){options=`<div class="ordered-answer-fields">${q.answer.map((_,slot)=>`<label class="form-field">第 ${slot+1} 空<select id="answer-slot-${slot}" class="select" data-answer-slot="${slot}" aria-label="第 ${slot+1} 空答案" ${a.graded?'disabled':''}><option value="">请选择</option>${q.options.map((text,i)=>`<option value="${i}" ${selected[slot]===i?'selected':''}>${String.fromCharCode(65+i)} · ${escape(text)}</option>`).join('')}</select></label>`).join('')}</div>`;}
  else{options=`<div class="options-list" ${multi?'role="group"':'role="radiogroup"'} aria-label="${multi?'多选题选项':'单选题选项'}">${q.options.map((o,index)=>{
    const chosen=selected.includes(index),correct=a.revealed&&hasAnswer&&q.answer.includes(index),incorrect=a.revealed&&chosen&&hasAnswer&&!q.answer.includes(index);
    const text=q.mode==='scan'&&o===String.fromCharCode(65+index)?`图片中的第 ${index+1} 个选项`:o;
    return `<button id="choice-${q.id}-${index}" class="option-button ${chosen?'selected':''} ${correct?'correct':''} ${incorrect?'incorrect':''}" data-action="option" data-index="${index}" ${multi?'aria-pressed="'+chosen+'"':'role="radio" aria-checked="'+chosen+'"'} ${a.graded||invalid?'disabled':''}><span class="option-letter">${String.fromCharCode(65+index)}</span><span class="option-text">${escape(text)}</span>${correct?icon('check'):incorrect?icon('close'):''}</button>`;
  }).join('')}</div>`;}
  let answer='';
  if(a.revealed){
    const tone=invalid?'neutral':a.correct?'correct':'incorrect';
    const title=invalid?'原题问题与参考结论':a.correct?'回答正确':a.graded?'回答错误':'参考答案与解析';
    answer=`<section class="answer-panel ${tone}" role="status" aria-label="本题解析"><h2 class="answer-title">${icon(invalid?'info':a.correct?'check':'book')}${title}</h2><p class="answer-description">参考答案：<strong>${escape(referenceLabel(q))}</strong>${selected.length?`<span>你的选择：${ordered?selected.map((x,i)=>`第${i+1}空 ${x<0?'未选':String.fromCharCode(65+x)}`).join('；'):selected.map(x=>String.fromCharCode(65+x)).join('、')}</span>`:''}</p><div class="answer-explanation"><strong>解析</strong><p>${escape(q.explanation)}</p></div>${q.reviewNote?`<p class="answer-footnote">${escape(q.reviewNote)}</p>`:''}${invalid?'<p class="answer-footnote">原题存在歧义或选项问题，本题不计入正误统计。</p>':multi||ordered?`<p class="answer-footnote">${a.graded?'本题结果已保存。':'可继续调整所选答案，切题时保存本次最终结果。'}</p>`:''}</section>`;
  }
  const typeLabel=invalid?'原题问题说明':ordered?'按序填空':multi?'多选题':q.mode==='scan'?'原图选择题':'单选题';
  const reference=q.mode==='text'&&q.images.length?`<details class="reference-details"><summary>${icon('book')}原始题图</summary><p>原图作答痕迹不作为正确性依据，以参考答案与解析为准。</p>${q.images.map((src,i)=>`<button class="scan-image-button" data-action="image" data-src="${escape(src)}" aria-label="放大原题图"><img class="scan-image" src="${escape(src)}" alt="原题参考图 ${i+1}" loading="lazy"></button>`).join('')}</details>`:'';
  const source=state.settings.showSource?`<p class="question-source">来源 ${escape(q.sourceCode || '')} · ${escape(q.source)} · 原题 ${escape(q.originalNumber)}</p>`:'';
  return `<section class="focus-workspace"><div class="focus-toolbar"><div class="focus-session-info"><strong>${escape(modeNames[session.mode] || '顺序练习')}</strong><span>${escape(chapterName(session.chapter))}</span><span class="focus-position">${session.index+1} / ${session.ids.length}</span><span class="focus-live-status" role="status" aria-live="polite"></span></div><div class="focus-tools"><label class="focus-font-select">字号<select id="practice-font" class="select" aria-label="题目字号"><option value="normal" ${state.settings.fontSize==='normal'?'selected':''}>22 px</option><option value="large" ${state.settings.fontSize==='large'?'selected':''}>26 px</option></select></label><button id="focus-map-button" class="focus-tool-button" data-action="question-map" title="答题卡" aria-label="打开答题卡">${icon('grid')}<span>答题卡</span></button><button class="focus-tool-button" data-action="practice-options" title="更换练习" aria-label="更换练习">${icon('settings')}<span>更换练习</span></button><button class="focus-tool-button" data-action="exit-practice" title="退出练习" aria-label="退出练习">${icon('close')}<span>退出</span></button></div></div>
    <div class="focus-reader" data-question-id="${q.id}"><article class="focus-question"><div class="question-header"><div class="question-tags"><span class="pill accent">${escape(q.topic)}</span><span class="pill muted">${typeLabel}</span></div><button class="icon-button ${state.favorites.includes(q.id)?'is-favorite':''}" data-action="favorite" data-id="${q.id}" aria-label="${state.favorites.includes(q.id)?'取消收藏':'收藏此题'}" aria-pressed="${state.favorites.includes(q.id)}">${icon('star')}</button></div><div class="question-number" id="question-title" tabindex="-1"><strong>第 ${label(q.number)} 题</strong><span>${session.index+1} / ${session.ids.length}</span></div>${multi?'<p class="question-hint">可勾选多个选项，解析在下方显示；切题时保存最终选择。</p>':ordered?'<p class="question-hint">按空位顺序选择，完成全部空位后显示解析。</p>':''}${stem}<div class="focus-option-zone">${options}${answer}</div>${reference}${source}</article></div>
    <footer class="focus-actions"><button class="button secondary" data-action="previous" ${session.index===0?'disabled':''}>← 上一题</button><span class="focus-navigation-status">${invalid?'本题不计正误':a.graded?'已作答 · 结果已保存':a.revealed?'所选即作答 · 切题时保存':'点击选项即可作答'}</span><button class="button primary" data-action="next">下一题 →</button></footer></section>`;
}
function showQuestionMap(){const session=state.session;if(!session)return;showModal(`<div class="question-map focus-question-map">${session.ids.map((id,index)=>`<button class="question-dot ${getQuestionStatus(state,id)} ${index===session.index?'current':''}" data-action="jump" data-index="${index}" aria-label="转到本组第 ${index+1} 题">${index+1}</button>`).join('')}</div>`,'','本组答题卡');}
function showPracticeOptions(){showModal(`<div class="focus-filter-panel"><p>选择知识模块和练习模式，开始新题组。</p><div class="filter-bar">${modeSelect(filter.mode)}${chapterSelect(filter.chapter)}${topicSelect(filter.chapter,filter.topic,'practice-topic')}<button class="button primary" data-action="start-filter">开始练习</button></div></div>`,'','更换练习');}
function empty(title,description,button='去开始练习',action='practice'){return `<div class="empty-state">${icon(view==='favorites'?'star':view==='wrong'?'check':'search')}<h2>${title}</h2><p>${description}</p><button class="button primary" data-action="${action}">${button} ${icon('arrow')}</button></div>`;}
function collection(mode){
  const items=selectQuestions(questions,{mode},state),isWrong=mode==='wrong';
  const actions=items.length?`<div class="collection-actions"><button class="button primary" data-action="collection-practice" data-mode="${mode}">${icon('play')}${isWrong?'重练全部错题':'练习全部收藏'} · ${items.length}</button>${isWrong?'<button class="button danger" data-action="clear-wrong">清空错题本</button>':''}</div>`:'';
  return `${heading(isWrong?'REVIEW & GROW':'YOUR COLLECTION',isWrong?'每次回顾，都是一次进步。':'把值得再看的题，留在这里。',isWrong?'答错后自动收录，答对后移出；也可手动清理，历史作答记录仍会保留。':'收藏会随账号同步，随时回来巩固重要知识点。',actions)}
  ${items.length?`<div class="library-list">${items.map(q=>questionRow(q,true)).join('')}</div>`:empty(isWrong?'错题本还是空的':'还没有收藏题目',isWrong?'完成练习后，待巩固的知识点会出现在这里。':'练习时点击星标，就能把题目加入收藏。')}`;
}
function questionRow(q,removable=false){
  const status=getQuestionStatus(state,q.id),title=q.mode==='scan'?`${q.topic} · 原图题`:q.stem;
  return `<div class="library-item"><button class="library-open" data-action="open-question" data-id="${q.id}"><span class="library-number">${label(q.number)}</span><span class="library-main"><strong class="library-title">${escape(title)}</strong><span class="library-meta">${escape(chapterName(q.chapter))} <span>·</span> ${escape(q.topic)} <span class="pill ${status==='wrong'?'warning':status==='done'?'success':'muted'}">${status==='wrong'?'待复习':status==='done'?'已掌握':status==='reviewed'?'已移出错题本':'未练习'}</span>${q.answer?.length?'<span class="auto-tag">自动判分</span>':''}</span></span>${icon('chevron')}</button><button class="icon-button ${state.favorites.includes(q.id)?'is-favorite':''}" data-action="favorite" data-id="${q.id}" aria-label="${state.favorites.includes(q.id)?'取消收藏':'收藏第 '+q.number+' 题'}" title="收藏" aria-pressed="${state.favorites.includes(q.id)}">${icon('star')}</button>${removable&&view==='wrong'?`<button class="button secondary small wrong-remove" data-action="remove-wrong" data-id="${q.id}" aria-label="将第 ${q.number} 题移出错题本">移出</button>`:''}</div>`;
}
function library(){
  const items=selectQuestions(questions,libraryFilter,state),pages=Math.max(1,Math.ceil(items.length/20));libraryPage=Math.min(libraryPage,pages);
  const page=items.slice((libraryPage-1)*20,libraryPage*20);
  return `${heading('QUESTION LIBRARY','知识有体系，练习有方向。',`共 ${questions.length} 道题，按章节、知识点或关键词，找到你想巩固的内容。`)}<div class="filter-bar library-filters"><label class="search-box">${icon('search')}<span class="sr-only">搜索题目或知识点</span><input id="library-search" class="input" placeholder="搜索题干、知识点或题号…" value="${escape(libraryFilter.query)}" autocomplete="off"></label>${chapterSelect(libraryFilter.chapter,'library-chapter')}${modeSelect(libraryFilter.mode,'library-mode')}</div><div class="library-result-heading"><span>找到 <strong>${items.length}</strong> 道题</span><button class="text-link" data-action="library-practice" ${!items.length?'disabled':''}>练习筛选结果 ${icon('arrow')}</button></div>${items.length?`<div class="library-list">${page.map(q=>questionRow(q)).join('')}</div><div class="pagination"><button class="button secondary small" data-action="library-prev" ${libraryPage===1?'disabled':''}>上一页</button><span>${libraryPage} / ${pages}</span><button class="button secondary small" data-action="library-next" ${libraryPage===pages?'disabled':''}>下一页</button></div>`:empty('没有找到相关题目','换一个关键词或清除筛选，再试一次。','清除筛选','clear-search')}`;
}
function settings(){
  return `${heading('MAKE IT YOURS','按你的习惯，安心地练习。','调整阅读体验，管理账号和学习记录。')}
  <section class="settings-card"><h2>${icon('user')}账号与同步</h2>${account.user?`<div class="account-profile"><span class="account-avatar">${escape(account.user.username.slice(0,1).toUpperCase())}</span><div><strong>${escape(account.user.username)}</strong><p>${account.status==='online'?'已连接服务器，进度自动同步':'当前记录已保存在此设备，联网后自动补传'}${account.queue.length?' · 待同步 '+account.queue.length+' 条':''}</p></div><button class="button secondary small" data-action="logout">退出登录</button></div><div class="settings-account-actions"><button class="button secondary" data-action="sync">${icon('cloud')}立即同步</button><button class="button ghost" data-action="password">修改密码</button></div>`:`<p>登录同一个账号，就能在电脑与手机之间继续练习。</p><button class="button primary" data-action="auth">登录 / 注册</button>`}</section>
  <section class="settings-card"><h2>${icon('settings')}练习与阅读</h2><div class="settings-grid"><div class="settings-field"><span><strong class="settings-label">点选即作答</strong><span class="settings-hint">解析在选项下方显示，通过上一题、下一题手动切换。</span></span></div><label class="settings-field"><span><strong class="settings-label">显示题目来源</strong><span class="settings-hint">便于回到原资料查阅。</span></span><input class="switch" id="setting-source" type="checkbox" ${state.settings.showSource?'checked':''} ${!account.user?'disabled':''}></label><label class="settings-field"><span><strong class="settings-label">题目字号</strong><span class="settings-hint">放大题干与选项，阅读更轻松。</span></span><select class="select" id="setting-font" aria-label="题目字号" ${!account.user?'disabled':''}><option value="normal" ${state.settings.fontSize==='normal'?'selected':''}>标准 22 px</option><option value="large" ${state.settings.fontSize==='large'?'selected':''}>大字 26 px</option></select></label></div></section>
  <section class="settings-card"><h2>${icon('download')}学习记录备份</h2><p>备份包含答题记录、错题、收藏和设置。导入会替换当前账号记录，并同步到其他设备。</p><div class="settings-account-actions"><button class="button primary" data-action="export" ${!account.user?'disabled':''}>${icon('download')}导出备份</button><button class="button secondary" data-action="import" ${!account.user?'disabled':''}>${icon('upload')}导入备份</button></div></section>
  <section class="settings-card"><h2>${icon('book')}关于题库</h2><p>共 533 道选择题，编号与整理后的 Word 题库一致。题干条件、数值或选项有明显区别的题目分别保留。</p><div class="about-grid"><div><strong>${questions.filter(q=>q.answer?.length&&q.questionType!=='invalid').length} 道</strong><span>参考答案与自动判分</span></div><div><strong>${questions.filter(q=>q.questionType==='invalid').length} 道</strong><span>原题问题与参考结论</span></div></div><p class="settings-hint">全部题目均提供参考解析。原资料错误或有歧义的地方会单独说明。原图保留的作答痕迹不作为正确性依据。</p></section>
  <section class="settings-card danger-zone"><h2>清空学习记录</h2><p>会清空当前账号在所有设备上的答题记录、收藏与练习设置。建议先导出备份。</p><button class="button danger" data-action="reset" ${!account.user?'disabled':''}>清空当前账号记录</button></section>`;
}
function startSession(config={},limit=null,custom=null){
  if(!logged(()=>startSession(config,limit,custom)))return;
  const settings={...filter,...config};
  let list=custom || selectQuestions(questions,settings,state);
  if(settings.mode==='random')list=shuffle(list);
  if(limit)list=list.slice(0,limit);
  if(!list.length){toast('当前筛选下没有可练习的题目。');return;}
  commitCurrentDraft();closeModal();filter={...settings,query:''};round=new Map();sessionAnswered=new Set();sessionCorrect=0;
  saveSession({ids:list.map(q=>q.id),index:0,mode:settings.mode,chapter:settings.chapter,topic:settings.topic,startedAt:new Date().toISOString()});
  navigate('practice');window.scrollTo({top:0,behavior:'instant'});
}
function commitCurrentDraft(){
  const q=currentQuestion(),a=q&&round.get(q.id);
  if(!q||!a||a.graded||!a.dirty||!isComplete(q,a)||!account.user)return;
  const correct=evaluateAnswer(q,a.selected);if(correct===null)return;
  a.revealed=true;a.graded=true;a.correct=correct;a.dirty=false;
  removeDraft(q.id);account.update({type:'answer',questionId:q.id,correct,answer:a.selected,graded:'auto'});
  if(!sessionAnswered.has(q.id)){sessionAnswered.add(q.id);if(correct)sessionCorrect++;}
}
function changeQuestion(index){
  const s=state.session;if(!s || index<0 || index>=s.ids.length)return;
  commitCurrentDraft();closeModal();saveSession({...s,index});render();$('#question-title')?.focus({preventScroll:true});const reader=$('.focus-reader');if(reader)reader.scrollTop=0;
}
function chooseOption(index){
  const q=currentQuestion();if(!q||q.questionType==='ordered'||q.questionType==='invalid')return;
  if(!logged(()=>chooseOption(index)))return;
  const a=qState(q.id);if(a.graded)return;
  if(q.questionType==='multiple'||q.answer?.length>1){a.selected=a.selected.includes(index)?a.selected.filter(i=>i!==index):[...a.selected,index].sort((a,b)=>a-b);a.revealed=a.selected.length>0;a.correct=a.revealed?evaluateAnswer(q,a.selected):null;a.dirty=true;saveDraft(q,a);render();}
  else{a.selected=[index];a.revealed=true;a.correct=evaluateAnswer(q,a.selected);a.dirty=true;commitCurrentDraft();render();}
}
function finish(){
  const n=sessionAnswered.size,correct=sessionCorrect;
  showModal(`<div class="result-card"><div class="result-emblem">${icon('check')}</div><p class="eyebrow">A LITTLE PROGRESS EVERY DAY</p><h2>这一组，练习完成。</h2><p>每一次认真思考，都在让知识更牢固。</p><div class="result-score">${n}<small>道已作答</small></div><div class="result-stats"><span>本次答对 <strong>${correct}</strong></span><span>本次答错 <strong>${n-correct}</strong></span></div><p class="settings-hint">未选择的题目不计入练习记录；已有学习进度已随账号保存。</p></div>`,`<button class="button secondary" data-action="close-modal">回到本组</button><button class="button primary" data-action="finish-home">返回学习概览 ${icon('arrow')}</button>`,'练习小结');
}
function showModal(content,footer='',title=''){
  modalReturn=document.activeElement;
  $('#modal-root').innerHTML=`<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${escape(title || '提示')}"><header class="modal-header"><h2>${escape(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="关闭弹窗">${icon('close')}</button></header><div class="modal-body">${content}</div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}</section></div>`;
  document.body.classList.add('modal-open');setTimeout(()=>$('#modal-root input, #modal-root button')?.focus(),0);
}
function closeModal(){$('#modal-root').innerHTML='';document.body.classList.remove('modal-open');modalReturn?.isConnected&&modalReturn.focus();}
function showAuth(){
  const registering=authMode==='register';
  showModal(`<div class="auth-card"><div class="auth-logo">${icon('book')}</div>
    <h2>欢迎来到知序</h2><p class="auth-caption">登录账号，让电脑和手机接着练。</p>
    <div class="auth-tabs"><button class="auth-tab ${!registering?'active':''}" data-action="auth-mode" data-mode="login">登录</button><button class="auth-tab ${registering?'active':''}" data-action="auth-mode" data-mode="register">注册账号</button></div>
    <form id="auth-form" class="auth-form">
      <label class="form-field">用户名<input class="input" name="username" autocomplete="username" required minlength="3" maxlength="32" placeholder="3–32 个字符，可使用汉字"></label>
      <label class="form-field">密码<div class="password-input"><input class="input" id="auth-password" type="password" name="password" autocomplete="${registering?'new-password':'current-password'}" required minlength="8" maxlength="128" placeholder="至少 8 个字符"><button class="password-toggle" type="button" data-action="toggle-password" aria-label="显示密码">显示</button></div></label>
      ${registering?`<label class="form-field">邀请密码<input class="input" id="registration-invite" name="inviteCode" type="password" autocomplete="off" required maxlength="256" placeholder="请输入管理员提供的邀请密码" aria-describedby="invite-hint"></label><p class="settings-hint" id="invite-hint">邀请密码由网站管理员提供。请妥善保存自己的账号密码，当前版本不提供邮件找回。</p>`:''}
      <p class="form-error" id="auth-error" role="alert" hidden></p>
      <button class="button primary auth-submit" type="submit">${registering?'验证邀请并注册':'登录并同步进度'} ${icon('arrow')}</button>
    </form></div>`,'',registering?'邀请注册':'账号登录');
}
function showPassword(){showModal(`<form id="password-form" class="auth-form"><label class="form-field">当前密码<input class="input" name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label><label class="form-field">新密码<input class="input" name="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label><p class="form-error" id="password-error" role="alert" hidden></p><button class="button primary" type="submit">保存新密码</button></form>`,'','修改密码');}
function confirmAction(title,body,action){showModal(`<p>${body}</p>`,`<button class="button secondary" data-action="close-modal">取消</button><button class="button danger" data-action="${action}">确认${title}</button>`,title);}
function confirmWrongRemoval(questionIds,all=false){
  if(!logged(()=>confirmWrongRemoval(questionIds,all)))return;
  pendingWrongTargets=questionIds.filter(id=>isWrongRecord(state.records[id])).map(id=>({questionId:id,lastAt:state.records[id].lastAt}));
  if(!pendingWrongTargets.length){toast('当前没有需要移出的错题');return;}
  confirmAction(all?'清空错题本':'移出错题',`将把 ${pendingWrongTargets.length} 道题移出错题本，保留历史作答记录、收藏和设置。以后再次答错时，题目仍会自动加入错题本。`,'confirm-wrong-removal');
}
function setImageZoom(value){
  const viewer=$('#modal-root .image-viewer'),image=$('#zoom-image');if(!viewer||!image)return;
  imageZoom=Math.max(1,Math.min(4,value));
  if(imageZoom===1){image.style.width='';image.style.maxWidth='100%';viewer.removeAttribute('data-zoomed');}
  else{image.style.width=Math.round(viewer.clientWidth*imageZoom)+'px';image.style.maxWidth='none';viewer.setAttribute('data-zoomed','true');}
  $('#image-zoom-label').textContent=Math.round(imageZoom*100)+'%';
}

document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-action]');if(!target || target.disabled)return;
  const {action,id,mode,index,src}=target.dataset;
  if(action==='backdrop' && event.target!==target)return;
  try{
    switch(action){
      case 'menu':menuOpen=!menuOpen;render();break;
      case 'close-menu':menuOpen=false;render();break;
      case 'settings':navigate('settings');break;
      case 'auth':showAuth();break;
      case 'auth-mode':authMode=mode;showAuth();break;
      case 'toggle-password':{const field=$('#auth-password');field.type=field.type==='password'?'text':'password';target.textContent=field.type==='password'?'显示':'隐藏';target.setAttribute('aria-label',field.type==='password'?'显示密码':'隐藏密码');break;}
      case 'close-modal':case 'backdrop':closeModal();break;
      case 'chapter':startSession({mode:'all',chapter:id,topic:'all'});break;
      case 'daily':startSession({mode:'random',chapter:'all',topic:'all'},20);break;
      case 'random':startSession({mode:'random',chapter:'all',topic:'all'},20);break;
      case 'practice':navigate('practice');break;
      case 'continue':if(logged(()=>navigate('practice')))navigate('practice');break;
      case 'browse':navigate('library');break;
      case 'start-filter':startSession();break;
      case 'question-map':showQuestionMap();break;
      case 'practice-options':showPracticeOptions();break;
      case 'exit-practice':navigate('home');break;
      case 'new-session':startSession({mode:'random'},20);break;
      case 'option':chooseOption(Number(index));break;
      case 'previous':changeQuestion(state.session.index-1);break;
      case 'next':commitCurrentDraft();if(state.session.index===state.session.ids.length-1)finish();else changeQuestion(state.session.index+1);break;
      case 'jump':changeQuestion(Number(index));break;
      case 'favorite':if(logged(()=>{account.update({type:'favorite',questionId:id,value:!state.favorites.includes(id)});})){account.update({type:'favorite',questionId:id,value:!state.favorites.includes(id)});toast(state.favorites.includes(id)?'已加入收藏':'已取消收藏');}break;
      case 'collection-practice':startSession({mode,chapter:'all',topic:'all'});break;
      case 'remove-wrong':confirmWrongRemoval([id]);break;
      case 'clear-wrong':confirmWrongRemoval(selectQuestions(questions,{mode:'wrong'},state).map(q=>q.id),true);break;
      case 'confirm-wrong-removal':{
        if(!logged())break;
        const targets=pendingWrongTargets;pendingWrongTargets=[];
        if(!targets.length){closeModal();break;}
        account.update({type:'dismiss-wrong',targets});closeModal();toast('已移出错题本，历史作答记录已保留');break;
      }
      case 'open-question':{
        const pool=view==='library'?selectQuestions(questions,libraryFilter,state):view==='wrong'||view==='favorites'?selectQuestions(questions,{mode:view},state):questions;
        const open=()=>{startSession({mode:'all',chapter:'all',topic:'all'},null,pool);const ix=pool.findIndex(q=>q.id===id);if(ix>=0)changeQuestion(ix);};if(logged(open))open();break;}
      case 'library-practice':startSession({...libraryFilter,query:''},null,selectQuestions(questions,libraryFilter,state));break;
      case 'library-prev':libraryPage--;render();window.scrollTo({top:0,behavior:'instant'});break;
      case 'library-next':libraryPage++;render();window.scrollTo({top:0,behavior:'instant'});break;
      case 'clear-search':libraryFilter={mode:'all',chapter:'all',topic:'all',query:''};libraryPage=1;render();break;
      case 'image':imageZoom=1;showModal(`<div class="image-tools"><button class="button secondary small" data-action="image-out" aria-label="缩小题图">− 缩小</button><button class="button primary small" data-action="image-in" aria-label="放大题图">＋ 放大</button><button class="button ghost small" data-action="image-fit">适应屏幕</button><span id="image-zoom-label" aria-live="polite">100%</span></div><div class="image-viewer" tabindex="0" aria-label="题图滚动区域"><img id="zoom-image" src="${escape(src)}" alt="放大的原题图示"></div><p class="image-zoom-hint">放大后可在图上左右滑动或滚动，查看完整题干与选项。</p>`,'','原题图示');break;
      case 'image-in':setImageZoom(imageZoom+.5);break;
      case 'image-out':setImageZoom(imageZoom-.5);break;
      case 'image-fit':setImageZoom(1);break;
      case 'sync':if(account.status==='expired'){showAuth();break;}await account.sync();toast(account.status==='online'?'进度已同步':'已保存在此设备，联网后将自动同步');render();break;
      case 'logout':commitCurrentDraft();await account.logout();round.clear();toast('已退出登录');navigate('home');break;
      case 'password':showPassword();break;
      case 'export':{if(!logged())break;const blob=new Blob([exportBackup(state)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`知序学习记录_${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('学习记录已导出');break;}
      case 'import':if(logged())$('#backup-file').click();break;
      case 'reset':confirmAction('清空记录','将清空当前账号在所有设备上的答题记录、收藏和设置，建议先导出备份。','confirm-reset');break;
      case 'confirm-reset':target.disabled=true;await account.replace();round.clear();closeModal();toast('当前账号学习记录已清空');render();break;
      case 'confirm-import':target.disabled=true;await account.replace(window.pendingBackup);window.pendingBackup=null;round.clear();closeModal();toast('备份已导入并同步');render();break;
      case 'finish-home':closeModal();navigate('home');break;
    }
  }catch(e){target.disabled=false;toast(e.message || '操作失败，请稍后重试');}
});
document.addEventListener('change',async event=>{
  const {id,value,checked}=event.target;
  if(event.target.matches('[data-answer-slot]')){const q=currentQuestion();if(q){const a=qState(q.id);if(!a.graded){if(!a.selected.length)a.selected=Array(q.answer.length).fill(-1);a.selected[Number(event.target.dataset.answerSlot)]=value===''?-1:Number(value);a.dirty=true;a.revealed=isComplete(q,a);a.correct=a.revealed?evaluateAnswer(q,a.selected):null;saveDraft(q,a);render();}}return;}
  if(id==='practice-font'){account.update({type:'settings',settings:{...state.settings,fontSize:value}});return;}
  if(id==='practice-mode')filter.mode=value;
  if(id==='practice-chapter'){filter.chapter=value;filter.topic='all';const control=$('#practice-topic');if(control)control.outerHTML=topicSelect(filter.chapter,filter.topic,'practice-topic');}
  if(id==='practice-topic')filter.topic=value;
  if(id==='library-chapter'){libraryFilter.chapter=value;libraryPage=1;render();}
  if(id==='library-mode'){libraryFilter.mode=value;libraryPage=1;render();}
  if(id.startsWith('setting-')){const settings={...state.settings};if(id==='setting-source')settings.showSource=checked;if(id==='setting-font')settings.fontSize=value;account.update({type:'settings',settings});}
  if(id==='backup-file'){
    const file=event.target.files[0];event.target.value='';if(!file)return;
    if(file.size>2*1024*1024){toast('备份文件超过 2 MB，请检查文件。');return;}
    try{const raw=await file.text();const {importBackup}=await import('./core.js');const next=importBackup(raw,questions.map(q=>q.id));window.pendingBackup=raw;confirmAction('导入备份',`此备份包含 ${Object.keys(next.records).length} 道题的记录和 ${next.favorites.length} 道收藏题，将替换当前账号记录并同步到其他设备。`,'confirm-import');}catch(e){toast(e.message);}
  }
});
document.addEventListener('input',event=>{if(event.target.id==='library-search'){libraryFilter.query=event.target.value;libraryPage=1;render();}});
document.addEventListener('submit',async event=>{
  if(!['auth-form','password-form'].includes(event.target.id))return;
  event.preventDefault();const form=event.target,button=form.querySelector('[type="submit"]'),data=new FormData(form),error=form.querySelector('.form-error');button.disabled=true;error.hidden=true;
  try{
    if(form.id==='auth-form'){await account.login(data.get('username'),data.get('password'),authMode==='register',data.get('inviteCode') || '');closeModal();toast('已登录，学习进度已载入');const action=afterLogin;afterLogin=null;action?.();render();}
    else{await account.password(data.get('currentPassword'),data.get('newPassword'));closeModal();toast('密码已修改，其他设备需重新登录');}
  }catch(e){error.textContent=e.message;error.hidden=false;button.disabled=false;}
});
document.addEventListener('keydown',event=>{
  const modal=$('#modal-root .modal');
  if(event.key==='Escape'){if(modal)closeModal();else if(menuOpen){menuOpen=false;render();}return;}
  if(modal){if(event.key==='Tab'){const nodes=[...modal.querySelectorAll('button:not(:disabled),input,select,a[href]')];if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}return;}
  if(view!=='practice'||!currentQuestion()||event.ctrlKey||event.altKey||event.metaKey||/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName))return;
  if(/^[1-9]$/.test(event.key)){const index=Number(event.key)-1;if(index<currentQuestion().options.length){event.preventDefault();chooseOption(index);}}
  if(event.key==='ArrowRight'){event.preventDefault();if(state.session.index<state.session.ids.length-1)changeQuestion(state.session.index+1);else{commitCurrentDraft();finish();}}
  if(event.key==='ArrowLeft'){event.preventDefault();changeQuestion(state.session.index-1);}
});
window.addEventListener('hashchange',()=>{if(view==='practice')commitCurrentDraft();const name=location.hash.slice(1).split('/')[0];view=['home','practice','wrong','favorites','library','settings'].includes(name)?name:'home';menuOpen=false;render();window.scrollTo({top:0,behavior:'instant'});});
window.addEventListener('online',()=>{if(initialized)void account.sync();});
document.addEventListener('visibilitychange',()=>{if(initialized&&!document.hidden)void account.sync();});

async function boot(){
  try{
    const response=await fetch('./data/questions.json',{cache:'no-cache'});if(!response.ok)throw new Error('无法载入题库');bank=await response.json();questions=bank.questions;byId=new Map(questions.map(q=>[q.id,q]));
    account=new LearningAccount(questions.map(q=>q.id),next=>{state=next;if(initialized)render();},message=>{if(message)toast(message);if(initialized)render();});
    state=account.state;view=location.hash.slice(1).split('/')[0] || 'home';
    await account.initialize();state=account.state;initialized=true;
    if(state.session)filter={mode:state.session.mode,chapter:state.session.chapter,topic:state.session.topic,query:''};
    render();setInterval(()=>{if(!document.hidden)void account.sync();},20000);
  }catch(e){$('#app').innerHTML=`<main class="load-error"><h1>题库暂时无法载入</h1><p>请检查网络，并确认后端服务已启动。</p><p>${escape(e.message)}</p><button class="button primary" id="reload-app">重新加载</button></main>`;$('#reload-app').onclick=()=>location.reload();}
}
void boot();
