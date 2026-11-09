import fs from 'node:fs';
import path from 'node:path';

export function loadBanks(dist) {
  const data=path.join(dist,'data');
  const catalog=JSON.parse(fs.readFileSync(path.join(data,'subjects.json'),'utf8'));
  const banks=new Map();
  const all={title:'全部科目',total:0,chapters:[],questions:[]};
  const questionIds=new Set(),chapterIds=new Set();
  for(const {id,title,file} of catalog){
    if(!/^[a-z][a-z0-9-]*$/.test(id) || banks.has(id) || !/^[a-z][a-z0-9-]*\.json$/.test(file))throw new Error('科目配置无效');
    const {questions,chapters}=JSON.parse(fs.readFileSync(path.join(data,file),'utf8'));
    for(const chapter of chapters){
      if(chapterIds.has(chapter.id))throw new Error('章节 ID 重复：'+chapter.id);
      chapterIds.add(chapter.id);
    }
    for(const question of questions){
      if(questionIds.has(question.id))throw new Error('题目 ID 重复：'+question.id);
      questionIds.add(question.id);
    }
    banks.set(id,{title,total:questions.length,chapters,questions});
    all.chapters.push(...chapters);
    all.questions.push(...questions);
  }
  all.total=all.questions.length;
  const empty={title:'题库',total:0,chapters:[],questions:[]};
  const views=new Map([[null,all],...banks]);
  for(const bank of views.values()){
    bank.ids=new Set(bank.questions.map(q=>q.id));
    bank.images=new Set(bank.questions.flatMap(q=>q.images || []).map(file=>'/'+file));
  }
  return {subjects:catalog.map(({id,title})=>({id,title})),banks,all,empty,
    forUser:user=>user?(views.get(user.subject) || empty):empty};
}
