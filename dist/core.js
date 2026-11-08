export const STORAGE_KEY = 'zhixu-ds-progress-v1';
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const count = n => Number.isFinite(n) ? Math.max(0, Math.min(10000000, Math.floor(n))) : 0;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const choices = a => Array.isArray(a) ? a.filter(x => Number.isInteger(x) && x >= 0 && x < 26).slice(0,26) : [];

export function evaluateAnswer(question, selected) {
  if(question.questionType==='invalid' || !Array.isArray(question.answer) || !question.answer.length)return null;
  const received=choices(selected);
  if(question.questionType==='ordered')return JSON.stringify(received)===JSON.stringify(question.answer);
  const actual=[...new Set(received)].sort((a,b)=>a-b);
  const expected=[...new Set(question.answer)].sort((a,b)=>a-b);
  return JSON.stringify(actual)===JSON.stringify(expected);
}

export function referenceLabel(question) {
  if(question.referenceAnswer)return question.referenceAnswer;
  const answer=question.answer || [];
  if(question.questionType==='ordered')return answer.map((x,i)=>`第 ${i+1} 空：${String.fromCharCode(65+x)}`).join('；');
  return answer.map(x=>String.fromCharCode(65+x)).join('、');
}

export function createState() {
  return {version:1, records:{}, favorites:[], daily:{}, session:null,
    settings:{autoNext:false, showSource:true, fontSize:'normal'}, updatedAt:new Date().toISOString()};
}

export function normalizeState(raw, bankIds) {
  const result = createState();
  const ids = new Set(bankIds);
  if (!plain(raw)) return result;
  if (plain(raw.records)) for (const [id, r] of Object.entries(raw.records)) {
    if (!ids.has(id) || !plain(r) || typeof r.lastCorrect !== 'boolean') continue;
    const attempts = count(r.attempts);
    if (!attempts) continue;
    result.records[id] = {attempts, correctCount:Math.min(attempts,count(r.correctCount)),
      wrongCount:Math.min(attempts,count(r.wrongCount)), lastCorrect:r.lastCorrect,
      lastAnswer:choices(r.lastAnswer), lastAt:validTime(r.lastAt) ? r.lastAt : '',
      mastered:r.lastCorrect, grading:r.grading === 'auto' ? 'auto' : 'self',wrongDismissed:r.wrongDismissed===true};
  }
  result.favorites = Array.isArray(raw.favorites) ? [...new Set(raw.favorites.filter(id => typeof id === 'string' && ids.has(id)))] : [];
  if (plain(raw.daily)) for (const [date,d] of Object.entries(raw.daily)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !plain(d)) continue;
    result.daily[date] = {attempts:count(d.attempts),correct:Math.min(count(d.attempts),count(d.correct))};
  }
  if (plain(raw.settings)) {
    result.settings.autoNext = raw.settings.autoNext === true;
    result.settings.showSource = raw.settings.showSource !== false;
    result.settings.fontSize = raw.settings.fontSize === 'large' ? 'large' : 'normal';
  }
  if (plain(raw.session) && Array.isArray(raw.session.ids)) {
    const sessionIds = [...new Set(raw.session.ids.filter(id => typeof id === 'string' && ids.has(id)))];
    if (sessionIds.length) result.session = {ids:sessionIds,index:Math.min(count(raw.session.index),sessionIds.length-1),
      mode:['all','random','wrong','favorites','unanswered','auto'].includes(raw.session.mode) ? raw.session.mode : 'all',
      chapter:typeof raw.session.chapter === 'string' ? raw.session.chapter.slice(0,50) : 'all',
      topic:typeof raw.session.topic === 'string' ? raw.session.topic.slice(0,100) : 'all',
      ...(validTime(raw.session.startedAt) ? {startedAt:new Date(raw.session.startedAt).toISOString()} : {})};
  }
  result.updatedAt = validTime(raw.updatedAt) ? raw.updatedAt : result.updatedAt;
  return result;
}

export function selectQuestions(questions, filter = {}, state = createState()) {
  const query = String(filter.query || '').trim().toLocaleLowerCase();
  return questions.filter(q => {
    if (filter.chapter && filter.chapter !== 'all' && q.chapter !== filter.chapter) return false;
    if (filter.topic && filter.topic !== 'all' && q.topic !== filter.topic) return false;
    if (filter.mode === 'wrong' && !isWrongRecord(state.records[q.id])) return false;
    if (filter.mode === 'favorites' && !state.favorites.includes(q.id)) return false;
    if (filter.mode === 'unanswered' && state.records[q.id]) return false;
    if (filter.mode === 'auto' && !q.answer?.length) return false;
    if (query && !`${q.number} ${q.stem} ${(q.options || []).join(' ')} ${q.topic} ${q.searchText || ''}`.toLocaleLowerCase().includes(query)) return false;
    return true;
  });
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export function recordAnswer(state, id, correct, {answer = [], graded = 'auto', now = new Date().toISOString()} = {}) {
  if (typeof id !== 'string' || !id || ['__proto__','constructor','prototype'].includes(id) || typeof correct !== 'boolean') throw new Error('答题记录无效');
  if (!validTime(now)) throw new Error('答题时间无效');
  const previous = state.records[id];
  const date = localDate(new Date(now));
  const daily = state.daily[date] || {attempts:0,correct:0};
  return {...state, records:{...state.records,[id]:{
    attempts:(previous?.attempts || 0)+1, correctCount:(previous?.correctCount || 0)+(correct?1:0),
    wrongCount:(previous?.wrongCount || 0)+(correct?0:1), lastCorrect:correct, lastAnswer:choices(answer),
    lastAt:now, mastered:correct, grading:graded === 'self' ? 'self' : 'auto'}},
    daily:{...state.daily,[date]:{attempts:daily.attempts+1,correct:daily.correct+(correct?1:0)}},updatedAt:now};
}

export function toggleFavorite(state, id) {
  return {...state,favorites:state.favorites.includes(id) ? state.favorites.filter(x => x !== id) : [...state.favorites,id],updatedAt:new Date().toISOString()};
}

export function isWrongRecord(record) {
  return record?.lastCorrect===false && record.wrongDismissed!==true;
}

// Match the displayed attempt so a concurrent newer mistake is never cleared.
export function dismissWrongAnswers(state, targets) {
  const records={...state.records};let changed=false;
  for(const target of targets) {
    const record=records[target.questionId];
    if(isWrongRecord(record) && record.lastAt===target.lastAt) {
      records[target.questionId]={...record,wrongDismissed:true};changed=true;
    }
  }
  return changed?{...state,records,updatedAt:new Date().toISOString()}:state;
}

export function getQuestionStatus(state, id) {
  const record=state.records[id];
  return record ? (record.lastCorrect ? 'done' : isWrongRecord(record)?'wrong':'reviewed') : 'unanswered';
}

export function getStats(questions, state) {
  const ids = new Set(questions.map(q => q.id));
  const records = Object.entries(state.records).filter(([id]) => ids.has(id)).map(([,r])=>r);
  const attempts = records.reduce((n,r)=>n+r.attempts,0);
  const correct = records.reduce((n,r)=>n+r.correctCount,0);
  const mastered = records.filter(r=>r.lastCorrect).length;
  let streak=0;
  const day=new Date();
  if (!state.daily[localDate(day)]?.attempts) day.setDate(day.getDate()-1);
  while (state.daily[localDate(day)]?.attempts) {streak++; day.setDate(day.getDate()-1); if (streak>3660) break;}
  return {total:questions.length,answered:records.length,mastered,wrong:records.filter(isWrongRecord).length,
    favorite:state.favorites.filter(id=>ids.has(id)).length,attempts,correct,
    accuracy:attempts?Math.round(correct/attempts*100):0,
    completion:questions.length?Math.round(records.length/questions.length*100):0,
    today:state.daily[localDate()]?.attempts || 0,streak};
}

export function shuffle(items, rng = Math.random) {
  const result = [...items];
  for (let i=result.length-1; i>0; i--) {const j=Math.floor(rng()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
  return result;
}

export function exportBackup(state) {
  return JSON.stringify({app:'zhixu-ds',version:1,exportedAt:new Date().toISOString(),data:state},null,2);
}

export function importBackup(raw, bankIds) {
  let value;
  try {value=typeof raw==='string'?JSON.parse(raw):raw;} catch {throw new Error('无法读取备份，请选择从本站导出的 JSON 文件。');}
  if (!plain(value) || value.app!=='zhixu-ds' || value.version!==1 || !plain(value.data) || !plain(value.data.records) || !Array.isArray(value.data.favorites)) throw new Error('备份格式不正确，请选择从本站导出的备份文件。');
  return normalizeState(value.data,bankIds);
}
