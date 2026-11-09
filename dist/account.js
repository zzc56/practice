import {STORAGE_KEY,createState,normalizeState,recordAnswer,importBackup,dismissWrongAnswers} from './core.js';

function apply(state,e) {
  if(e.type==='answer')return recordAnswer(state,e.questionId,e.correct,{answer:e.answer,graded:e.graded,now:e.occurredAt});
  if(e.type==='dismiss-wrong')return dismissWrongAnswers(state,e.targets);
  if(e.type==='favorite')return {...state,favorites:e.value?[...new Set([...state.favorites,e.questionId])]:state.favorites.filter(id=>id!==e.questionId)};
  if(e.type==='settings')return {...state,settings:{...state.settings,...e.settings}};
  if(e.type==='session')return {...state,session:e.session};
  return state;
}

export class LearningAccount {
  constructor(ids,onChange,onStatus,onBank) {
    this.ids=ids;this.onChange=onChange;this.onStatus=onStatus;this.user=null;this.state=createState();
    this.onBank=onBank;
    this.queue=[];this.revision=0;this.busy=null;this.lastSync=null;this.status='loading';
    this.key=STORAGE_KEY+':account:'+new URL('.',document.baseURI).pathname;
    try{this.cached=JSON.parse(localStorage.getItem(this.key) || 'null');}catch{this.cached=null;}
  }
  async api(route,method='GET',input) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(new URL('api'+route,new URL('.',document.baseURI)),{
        method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json','X-Requested-With':'zhixu'},
        body:input===undefined?undefined:JSON.stringify(input),signal:controller.signal,cache:'no-store'});
      let data;try{data=await response.json();}catch{throw new Error('服务响应异常，请确认网站后端已启动。');}
      if(!response.ok){const e=new Error(data.error || '操作失败，请稍后重试');e.status=response.status;throw e;}
      return data;
    }finally{clearTimeout(timer);}
  }
  save() {
    if(!this.user)return;
    try{const cached=JSON.stringify({user:this.user,state:this.state,queue:this.queue,revision:this.revision});localStorage.setItem(this.key,cached);localStorage.setItem(this.key+':'+this.user.id,cached);}
    catch{this.onStatus('浏览器存储已满，请保持联网，并及时导出备份。');}
  }
  changed(){this.save();this.onChange(this.state);}
  setStatus(value){this.status=value;this.onStatus();}
  restore(user) {
    if(this.user?.id===user.id){this.user=user;return;}
    try{const saved=JSON.parse(localStorage.getItem(this.key+':'+user.id) || 'null');if(saved?.user?.id===user.id)this.cached=saved;}catch{}
    this.user=user;
    if(this.cached?.user?.id===user.id){
      this.state=normalizeState(this.cached.state,this.ids);
      this.queue=Array.isArray(this.cached.queue)?this.cached.queue.filter(e=>e && typeof e.id==='string').slice(0,10000):[];
      this.revision=Number.isInteger(this.cached.revision)?this.cached.revision:0;
    }else{this.state=createState();this.queue=[];this.revision=0;}
  }
  async initialize() {
    try{
      const {user}=await this.api('/auth/me');
      if(user){await this.loadBank();this.restore(user);await this.sync();}else this.setStatus('guest');
    }catch(e){
      if(this.cached?.user && !this.onBank){this.restore(this.cached.user);this.setStatus('offline');this.changed();}
      else this.setStatus('unavailable');
    }
    this.onChange(this.state);
  }
  async loadBank() {
    if(!this.onBank)return;
    const bank=await this.api('/bank');
    this.ids=bank.questions.map(question=>question.id);
    this.onBank(bank);
  }
  async login(username,password,register=false,inviteCode='') {
    const {user}=await this.api(register?'/auth/register':'/auth/login','POST',{username,password,...(register?{inviteCode}:{})});
    await this.loadBank();
    this.restore(user);this.cached=null;this.changed();await this.sync();
  }
  update(event) {
    if(!this.user)throw new Error('请先登录账号');
    const id=globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const e={...event,id,occurredAt:new Date().toISOString()};
    this.state=apply(this.state,e);this.queue.push(e);this.changed();void this.sync();
  }
  async sync() {
    if(!this.user)return;
    if(this.busy)return this.busy;
    this.setStatus('syncing');
    this.busy=(async()=>{
      try{
        let rounds=0;
        do {
          const batch=this.queue.slice(0,100);
          const data=batch.length?await this.api('/progress/events','POST',{events:batch}):await this.api('/progress');
          const sent=new Set(batch.map(e=>e.id));this.queue=this.queue.filter(e=>!sent.has(e.id));
          const localSession=this.state.session;
          this.state=normalizeState(data.state,this.ids);this.revision=data.revision;
          for(const pending of this.queue)this.state=apply(this.state,pending);
          if(this.keepSession && localSession)this.state.session=localSession;
          this.lastSync=new Date();this.changed();rounds++;
        }while(this.queue.length && rounds<100);
        this.setStatus(this.queue.length?'offline':'online');
      }catch(e){this.setStatus(e.status===401?'expired':'offline');this.save();}
      finally{this.busy=null;}
    })();
    return this.busy;
  }
  async logout() {
    await this.sync();if(this.queue.length)throw new Error('还有未同步的记录，请联网同步后再退出。');
    await this.api('/auth/logout','POST',{});
    if(this.onBank){this.ids=[];this.onBank(null);}
    localStorage.removeItem(this.key);localStorage.removeItem(this.key+':'+this.user.id);this.cached=null;this.user=null;this.queue=[];this.state=createState();this.revision=0;this.setStatus('guest');this.onChange(this.state);
  }
  async replace(backup=null) {
    if(!this.user)throw new Error('请先登录账号');
    if(backup)importBackup(backup,this.ids);
    await this.sync();if(this.queue.length || this.status!=='online')throw new Error('请先联网同步，再导入或清空记录。');
    const data=await this.api(backup?'/progress/import':'/progress/reset','POST',{revision:this.revision,...(backup?{backup:typeof backup==='string'?JSON.parse(backup):backup}:{})});
    this.state=normalizeState(data.state,this.ids);this.revision=data.revision;this.queue=[];this.changed();
  }
  async password(currentPassword,newPassword){await this.api('/auth/password','POST',{currentPassword,newPassword});}
}
