import http from 'node:http';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, createHash, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {gzipSync, createGzip} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {createState, normalizeState, recordAnswer, importBackup, dismissWrongAnswers} from './dist/core.js';

const ROOT=path.dirname(fileURLToPath(import.meta.url)), DIST=path.join(ROOT,'dist');
const DIST_REAL=fs.realpathSync(DIST);
const DATA=path.resolve(process.env.DATA_DIR || path.join(ROOT,'data'));
const BASE=(process.env.BASE_PATH || '').replace(/\/$/,'');
if (BASE && !/^\/[a-zA-Z0-9_/-]+$/.test(BASE)) throw new Error('BASE_PATH 必须是以 / 开头的路径，例如 /practice');
const SECURE=process.env.COOKIE_SECURE==='true';
const TRUSTED_PROXY=process.env.TRUSTED_PROXY==='true';
const INVITE_CODE=process.env.INVITE_CODE || '';
const HOST=process.env.HOST || '127.0.0.1', PORT=Number(process.env.PORT || 3000);
const SESSION_AGE=30*86400*1000;
const bank=JSON.parse(fs.readFileSync(path.join(DIST,'data/questions.json'),'utf8'));
const ids=new Set(bank.questions.map(q=>q.id));
fs.mkdirSync(DATA,{recursive:true});
const db=new DatabaseSync(path.join(DATA,'practice.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS progress(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, state_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS events(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,event_id));`);
const sql={
  user:db.prepare('SELECT * FROM users WHERE username=?'),
  addUser:db.prepare('INSERT INTO users(username,display_name,salt,password_hash,created_at) VALUES(?,?,?,?,?)'),
  session:db.prepare('SELECT users.id, users.display_name AS username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?'),
  addSession:db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)'),
  deleteSession:db.prepare('DELETE FROM sessions WHERE token_hash=?'),
  progress:db.prepare('SELECT state_json,revision FROM progress WHERE user_id=?'),
  save:db.prepare('INSERT INTO progress(user_id,state_json,revision) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, revision=excluded.revision'),
  event:db.prepare('INSERT OR IGNORE INTO events(user_id,event_id,created_at) VALUES(?,?,?)'),
};
const hashToken=token=>createHash('sha256').update(token).digest('hex');
const derive=promisify(scrypt);
const rate=new Map();
const cookieName='zhixu_session';
function cookie(token,age=SESSION_AGE/1000){return `${cookieName}=${token}; Path=${BASE || '/'}; Max-Age=${age}; HttpOnly; SameSite=Lax${SECURE?'; Secure':''}`;}
function getToken(req){return (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1) || '';}
function clientIp(req){
  if(TRUSTED_PROXY){
    const real=req.headers['x-real-ip'];
    if(typeof real==='string' && net.isIP(real.trim()))return real.trim();
    const forwarded=req.headers['x-forwarded-for'];
    if(typeof forwarded==='string' && forwarded.length<=1024){
      const last=forwarded.split(',').map(s=>s.trim()).filter(Boolean).pop();
      if(last && net.isIP(last))return last;
    }
  }
  return req.socket.remoteAddress || '';
}
function acceptsGzip(req){return /\bgzip\b/.test(req.headers['accept-encoding'] || '');}
function matchesEtag(req,etag,mtimeMs){
  const inm=req.headers['if-none-match'];
  if(typeof inm==='string'){
    if(inm.trim()==='*')return true;
    return inm.split(',').some(raw=>{const tag=raw.trim().replace(/^W\//,'');return tag===etag;});
  }
  const ims=req.headers['if-modified-since'];
  if(typeof ims==='string'){
    const since=Date.parse(ims);
    return Number.isFinite(since) && Math.floor(mtimeMs/1000)*1000<=since;
  }
  return false;
}
function auth(req){const token=getToken(req);return token && token.length<200 ? sql.session.get(hashToken(token),Date.now()) : null;}
function sessionFor(userId,res){const token=randomBytes(32).toString('hex');sql.addSession.run(hashToken(token),userId,Date.now()+SESSION_AGE);res.setHeader('Set-Cookie',cookie(token));}
function fail(status,message){throw Object.assign(new Error(message),{status});}
function json(res,status,value){
  const body=Buffer.from(JSON.stringify(value));
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',Vary:'Accept-Encoding'};
  const payload=res.acceptGzip && body.length>=1024?gzipSync(body):body;
  if(payload!==body)headers['Content-Encoding']='gzip';
  headers['Content-Length']=payload.length;
  res.writeHead(status,headers);res.end(payload);
}
function security(res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}
function checkOrigin(req){
  const origin=req.headers.origin;
  if (origin) {
    let host;
    try {host=new URL(origin).host;} catch {fail(403,'请求来源无效');}
    if (origin!==process.env.APP_ORIGIN && host!==req.headers.host) fail(403,'请从本站页面提交请求');
  }
  if (req.headers['x-requested-with']!=='zhixu') fail(403,'请求格式无效');
}
async function body(req){
  let size=0, chunks=[];
  for await (const chunk of req) {size+=chunk.length;if(size>2*1024*1024) fail(413,'提交内容过大');chunks.push(chunk);}
  try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');if(!value || typeof value!=='object' || Array.isArray(value)) fail(400,'提交格式无效');return value;} catch(e){if(e.status)throw e;fail(400,'JSON 格式无效');}
}
function throttle(req,username=''){
  const key=`${clientIp(req)}|${username}`;const now=Date.now();const r=rate.get(key);
  const limit=username?20:1000;
  if(r && now<r.until && r.count>=limit) fail(429,'尝试次数较多，请 15 分钟后重试');
  if(!r || now>=r.until)rate.set(key,{count:1,until:now+15*60*1000});else r.count++;
  if(rate.size>10000) for(const [k,v] of rate) if(v.until<now)rate.delete(k);
}
function credentials(input){
  const display=typeof input.username==='string'?input.username.trim():'';
  if(!/^[\p{L}\p{N}_-]{3,32}$/u.test(display))fail(400,'用户名需为 3–32 个字母、数字、汉字、下划线或短横线');
  if(typeof input.password!=='string' || input.password.length<8 || input.password.length>128)fail(400,'密码需为 8–128 个字符');
  return {display,username:display.toLocaleLowerCase(),password:input.password};
}
function requireInvite(value){
  if(!INVITE_CODE.trim() || INVITE_CODE.length>256)fail(403,'站点尚未设置有效的邀请密码，暂时无法注册，请联系管理员');
  if(typeof value!=='string' || !value || value.length>256)fail(403,'请填写正确的邀请密码');
  const supplied=createHash('sha256').update(value).digest();
  const expected=createHash('sha256').update(INVITE_CODE).digest();
  if(!timingSafeEqual(supplied,expected))fail(403,'邀请密码不正确，请向管理员确认');
}
function loadProgress(userId){const row=sql.progress.get(userId);return {state:row?normalizeState(JSON.parse(row.state_json),ids):createState(),revision:row?.revision || 0};}
function applyEvent(state,event){
  if(!event || typeof event!=='object' || !/^[a-zA-Z0-9_-]{8,100}$/.test(event.id || '')) fail(400,'同步事件无效');
  if(event.type==='answer'){
    if(!ids.has(event.questionId) || typeof event.correct!=='boolean')fail(400,'答题记录无效');
    const occurredAt=typeof event.occurredAt==='string' && Number.isFinite(Date.parse(event.occurredAt)) && Date.parse(event.occurredAt)<=Date.now()+300000?event.occurredAt:new Date().toISOString();
    const next=recordAnswer(state,event.questionId,event.correct,{answer:event.answer,graded:event.graded,now:occurredAt});
    const previous=state.records[event.questionId];
    if(previous?.lastAt && Date.parse(previous.lastAt)>Date.parse(occurredAt)) next.records[event.questionId]={...next.records[event.questionId],lastCorrect:previous.lastCorrect,lastAnswer:previous.lastAnswer,lastAt:previous.lastAt,mastered:previous.mastered,grading:previous.grading,wrongDismissed:previous.wrongDismissed===true};
    return next;
  }
  if(event.type==='dismiss-wrong') {
    if(!Array.isArray(event.targets) || !event.targets.length || event.targets.length>ids.size)fail(400,'错题清理记录无效');
    for(const target of event.targets) {
      if(!target || !ids.has(target.questionId) || typeof target.lastAt!=='string' || target.lastAt.length>40)fail(400,'错题清理记录无效');
    }
    return dismissWrongAnswers(state,event.targets);
  }
  if(event.type==='favorite'){
    if(!ids.has(event.questionId) || typeof event.value!=='boolean')fail(400,'收藏记录无效');
    return {...state,favorites:event.value?[...new Set([...state.favorites,event.questionId])]:state.favorites.filter(x=>x!==event.questionId),updatedAt:new Date().toISOString()};
  }
  if(event.type==='settings') return {...state,settings:normalizeState({...state,settings:event.settings},ids).settings};
  if(event.type==='session') return {...state,session:normalizeState({...state,session:event.session},ids).session};
  fail(400,'未知同步事件');
}
async function api(req,res,route){
  if(req.method==='GET' && route==='/api/health')return json(res,200,{ok:true,total:bank.total});
  if(req.method==='GET' && route==='/api/auth/me')return json(res,200,{user:auth(req) || null});
  if(req.method!=='GET')checkOrigin(req);
  if(req.method==='POST' && ['/api/auth/register','/api/auth/login'].includes(route)){
    const payload=await body(req);
    const input=credentials(payload);throttle(req);throttle(req,input.username);
    const row=sql.user.get(input.username);
    if(route.endsWith('/register')){
      if(process.env.ALLOW_REGISTRATION==='false')fail(403,'本站已关闭新账号注册');
      requireInvite(payload.inviteCode);
      if(row)fail(409,'该用户名已被注册');
      const salt=randomBytes(16).toString('hex'), passwordHash=(await derive(input.password,salt,64)).toString('hex');
      let result;
      try {result=sql.addUser.run(input.username,input.display,salt,passwordHash,new Date().toISOString());} catch(e){if(String(e.message).includes('UNIQUE'))fail(409,'该用户名已被注册');throw e;}
      const id=Number(result.lastInsertRowid);sessionFor(id,res);return json(res,201,{user:{id,username:input.display}});
    }
    const salt=row?.salt || '00000000000000000000000000000000';
    const candidate=await derive(input.password,salt,64);
    if(!row || !timingSafeEqual(candidate,Buffer.from(row.password_hash,'hex')))fail(401,'用户名或密码不正确');
    sessionFor(row.id,res);return json(res,200,{user:{id:row.id,username:row.display_name}});
  }
  const user=auth(req);if(!user)fail(401,'请先登录账号');
  if(req.method==='POST' && route==='/api/auth/logout'){
    sql.deleteSession.run(hashToken(getToken(req)));res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});
  }
  if(req.method==='POST' && route==='/api/auth/password'){
    const input=await body(req);const current=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    throttle(req,`password-${user.id}`);
    if(typeof input.currentPassword!=='string' || input.currentPassword.length>128)fail(400,'请输入当前密码');
    const candidate=await derive(input.currentPassword,current.salt,64);
    if(!timingSafeEqual(candidate,Buffer.from(current.password_hash,'hex')))fail(400,'当前密码不正确');
    if(typeof input.newPassword!=='string' || input.newPassword.length<8 || input.newPassword.length>128)fail(400,'新密码需为 8–128 个字符');
    const salt=randomBytes(16).toString('hex'),passwordHash=(await derive(input.newPassword,salt,64)).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try {db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(salt,passwordHash,user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);sessionFor(user.id,res);db.exec('COMMIT');} catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,200,{ok:true});
  }
  if(req.method==='GET' && route==='/api/progress')return json(res,200,loadProgress(user.id));
  if(req.method==='POST' && route==='/api/progress/events'){
    const input=await body(req);if(!Array.isArray(input.events) || input.events.length>100)fail(400,'一次最多同步 100 条记录');
    db.exec('BEGIN IMMEDIATE');
    let current;
    try {
      current=loadProgress(user.id);
      for(const event of input.events){
        const next=applyEvent(current.state,event);
        const inserted=sql.event.run(user.id,event.id,new Date().toISOString());
        if(inserted.changes){current.state=next;current.revision++;}
      }
      sql.save.run(user.id,JSON.stringify(current.state),current.revision);db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,200,current);
  }
  if(req.method==='POST' && ['/api/progress/import','/api/progress/reset'].includes(route)){
    const input=await body(req);
    db.exec('BEGIN IMMEDIATE');
    let next;
    try {
      const current=loadProgress(user.id);if(input.revision!==current.revision)fail(409,'其他设备刚更新了进度，请同步后再操作');
      let state;
      if(route.endsWith('/import')){try{state=importBackup(input.backup,ids);}catch(e){fail(400,e.message);}}
      else state=createState();
      next={state,revision:current.revision+1};sql.save.run(user.id,JSON.stringify(state),next.revision);db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,200,next);
  }
  fail(404,'接口不存在');
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  security(res);
  res.acceptGzip=acceptsGzip(req);
  try{
    const url=new URL(req.url,'http://localhost');let pathname;
    try{pathname=decodeURIComponent(url.pathname);}catch{fail(400,'地址格式不正确');}
    if(BASE && pathname===BASE){res.writeHead(308,{Location:BASE+'/'});res.end();return;}
    if(BASE && !pathname.startsWith(BASE+'/'))fail(404,'页面不存在');
    const route=BASE?pathname.slice(BASE.length):pathname;
    if(route.startsWith('/api/'))return await api(req,res,route);
    if(!['GET','HEAD'].includes(req.method))fail(405,'不支持的请求方式');
    if(route.includes('\0') || route.includes('\\'))fail(400,'地址格式不正确');
    if(route.split('/').some(part=>part.startsWith('.')))fail(404,'文件不存在');
    const filename=path.resolve(DIST,'.'+(route==='/'?'/index.html':route));
    if(!filename.startsWith(DIST+path.sep))fail(404,'文件不存在');
    let stat;try{stat=fs.statSync(filename);}catch{fail(404,'文件不存在');}
    if(!stat.isFile())fail(404,'文件不存在');
    if(!fs.realpathSync(filename).startsWith(DIST_REAL+path.sep))fail(403,'文件访问被拒绝');
    const ext=path.extname(filename),type=MIME[ext] || 'application/octet-stream';
    const etag=`"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    res.setHeader('Content-Type',type);
    res.setHeader('Cache-Control',['.html','.json','.js','.css'].includes(ext)?'no-cache':'public, max-age=604800');
    res.setHeader('ETag',etag);
    res.setHeader('Last-Modified',new Date(Math.floor(stat.mtimeMs/1000)*1000).toUTCString());
    res.setHeader('Vary','Accept-Encoding');
    if(matchesEtag(req,etag,stat.mtimeMs)){res.writeHead(304);return res.end();}
    const compressible=/^(?:text\/|application\/(?:json|javascript)|image\/svg\+xml)/.test(type) && acceptsGzip(req);
    if(compressible)res.setHeader('Content-Encoding','gzip');
    else res.setHeader('Content-Length',stat.size);
    res.writeHead(200);
    if(req.method==='HEAD')return res.end();
    const stream=fs.createReadStream(filename);stream.on('error',()=>res.destroy());
    if(compressible)stream.pipe(createGzip()).pipe(res);else stream.pipe(res);
  }catch(e){if(!res.headersSent)json(res,e.status || 500,{error:e.status?e.message:'服务器暂时无法处理请求，请稍后重试'});else res.destroy();if(!e.status)console.error('Request failed:',e.message);}
});
server.requestTimeout=30000;server.headersTimeout=15000;
server.on('error',error=>{
  if(error.code==='EADDRINUSE')console.error(`启动失败：端口 ${PORT} 已被占用，请换一个 PORT 或先停掉占用该端口的进程。`);
  else if(error.code==='EACCES')console.error(`启动失败：没有权限监听 ${HOST}:${PORT}（1024 以下端口通常需要管理员权限）。`);
  else console.error('启动失败：'+(error.message || error));
  process.exit(1);
});
server.listen(PORT,HOST,()=>console.log(`知序已启动 http://${HOST}:${server.address().port}${BASE}/`));
const cleanup=setInterval(()=>{db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());},3600000);cleanup.unref();
function shutdown(){clearInterval(cleanup);server.close(()=>{db.close();process.exit(0);});setTimeout(()=>process.exit(0),5000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
