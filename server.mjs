import http from 'node:http';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomInt, createHash, createHmac, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {gzipSync, createGzip} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {loadBanks} from './banks.mjs';
import {availableProblems} from './judge/problems.mjs';
import {judge} from './judge/index.mjs';
import {createState, normalizeState, recordAnswer, importBackup, dismissWrongAnswers} from './dist/core.js';

const ROOT=path.dirname(fileURLToPath(import.meta.url)), DIST=path.join(ROOT,'dist');
const DIST_REAL=fs.realpathSync(DIST);
const DATA=path.resolve(process.env.DATA_DIR || path.join(ROOT,'data'));
const BASE=(process.env.BASE_PATH || '').replace(/\/$/,'');
if (BASE && !/^\/[a-zA-Z0-9_/-]+$/.test(BASE)) throw new Error('BASE_PATH 必须是以 / 开头的路径，例如 /practice');
const SECURE=process.env.COOKIE_SECURE==='true';
const TRUSTED_PROXY=process.env.TRUSTED_PROXY==='true';
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD || '';
const MAIL_KEY=process.env.RESEND_API_KEY?.trim();
const MAIL_FROM=process.env.MAIL_FROM?.trim();
const registrationOpen=process.env.ALLOW_REGISTRATION!=='false';
const emailRegistrationEnabled=Boolean(registrationOpen && MAIL_KEY && MAIL_FROM);
const EMAIL_CODE_AGE=10*60*1000, EMAIL_CODE_COOLDOWN=60*1000;
const HOST=process.env.HOST || '127.0.0.1', PORT=Number(process.env.PORT || 3000);
const SESSION_AGE=30*86400*1000;
const ADMIN_SESSION_AGE=12*3600*1000;
const catalog=loadBanks(DIST);
fs.mkdirSync(DATA,{recursive:true});
const db=new DatabaseSync(path.join(DATA,'practice.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS progress(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, state_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS events(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,event_id));
CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS registration_codes(invite_hash TEXT PRIMARY KEY, email TEXT NOT NULL, nonce TEXT NOT NULL, digest TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS registration_codes_email ON registration_codes(email, created_at);
CREATE TABLE IF NOT EXISTS invitations(code_hash TEXT PRIMARY KEY, subject TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT);`);
const userColumns=new Set(db.prepare('PRAGMA table_info(users)').all().map(column=>column.name));
if(!userColumns.has('disabled'))db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
if(!userColumns.has('last_login_at'))db.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT');
if(!userColumns.has('subject'))db.exec('ALTER TABLE users ADD COLUMN subject TEXT');
if(!userColumns.has('email'))db.exec('ALTER TABLE users ADD COLUMN email TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email)');
const sql={
  user:db.prepare('SELECT * FROM users WHERE username=?'),
  userCredentials:db.prepare('SELECT salt,password_hash FROM users WHERE id=? AND disabled=0'),
  userByEmail:db.prepare('SELECT id FROM users WHERE email=?'),
  addUser:db.prepare('INSERT INTO users(username,display_name,salt,password_hash,created_at,subject,email) VALUES(?,?,?,?,?,?,?)'),
  renameUser:db.prepare('UPDATE users SET username=?,display_name=? WHERE id=? AND disabled=0 AND password_hash=?'),
  session:db.prepare('SELECT users.id, users.display_name AS username,users.subject FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>? AND users.disabled=0'),
  addInvite:db.prepare('INSERT INTO invitations(code_hash,subject,created_at) VALUES(?,?,?)'),
  invite:db.prepare('SELECT subject FROM invitations WHERE code_hash=? AND used_at IS NULL'),
  consumeInvite:db.prepare('UPDATE invitations SET used_at=? WHERE code_hash=? AND used_at IS NULL'),
  registrationCode:db.prepare('SELECT * FROM registration_codes WHERE invite_hash=?'),
  recentEmailCode:db.prepare('SELECT 1 FROM registration_codes WHERE email=? AND created_at>?'),
  putCode:db.prepare('INSERT OR REPLACE INTO registration_codes(invite_hash,email,nonce,digest,created_at) VALUES(?,?,?,?,?)'),
  markCodeSent:db.prepare('UPDATE registration_codes SET sent=1 WHERE invite_hash=? AND nonce=?'),
  failCode:db.prepare('UPDATE registration_codes SET attempts=attempts+1 WHERE invite_hash=?'),
  deleteCode:db.prepare('DELETE FROM registration_codes WHERE invite_hash=?'),
  addSession:db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)'),
  deleteSession:db.prepare('DELETE FROM sessions WHERE token_hash=?'),
  progress:db.prepare('SELECT state_json,revision FROM progress WHERE user_id=?'),
  save:db.prepare('INSERT INTO progress(user_id,state_json,revision) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, revision=excluded.revision'),
  event:db.prepare('INSERT OR IGNORE INTO events(user_id,event_id,created_at) VALUES(?,?,?)'),
  adminSession:db.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at>?'),
  addAdminSession:db.prepare('INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,?)'),
  deleteAdminSession:db.prepare('DELETE FROM admin_sessions WHERE token_hash=?'),
  userById:db.prepare('SELECT id,username,display_name,created_at,last_login_at,disabled FROM users WHERE id=?'),
  deleteUser:db.prepare('DELETE FROM users WHERE id=?'),
  setDisabled:db.prepare('UPDATE users SET disabled=? WHERE id=?'),
  setPassword:db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?'),
  deleteUserSessions:db.prepare('DELETE FROM sessions WHERE user_id=?'),
  touchLogin:db.prepare('UPDATE users SET last_login_at=? WHERE id=?'),
};
const hashToken=token=>createHash('sha256').update(token).digest('hex');
const derive=promisify(scrypt);
const rate=new Map();
const cookieName='zhixu_session';
function cookie(token,age=SESSION_AGE/1000){return `${cookieName}=${token}; Path=${BASE || '/'}; Max-Age=${age}; HttpOnly; SameSite=Lax${SECURE?'; Secure':''}`;}
function getToken(req){return (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1) || '';}
const adminCookieName='zhixu_admin';
function adminCookie(token,age=ADMIN_SESSION_AGE/1000){return `${adminCookieName}=${token}; Path=${BASE || '/'}; Max-Age=${age}; HttpOnly; SameSite=Lax${SECURE?'; Secure':''}`;}
function getAdminToken(req){return (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(adminCookieName+'='))?.slice(adminCookieName.length+1) || '';}
function adminConfigured(){return Boolean(ADMIN_PASSWORD.trim()) && ADMIN_PASSWORD.length<=256;}
function adminAuth(req){const token=getAdminToken(req);return Boolean(token && token.length<200 && sql.adminSession.get(hashToken(token),Date.now()));}
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
function throttle(req,username='',limit=NaN){
  const key=`${clientIp(req)}|${username}`;const now=Date.now();const r=rate.get(key);
  const max=Number.isFinite(limit)?limit:(username?20:1000);
  if(r && now<r.until && r.count>=max) fail(429,'尝试次数较多，请 15 分钟后重试');
  if(!r || now>=r.until)rate.set(key,{count:1,until:now+15*60*1000});else r.count++;
  if(rate.size>10000) for(const [k,v] of rate) if(v.until<now)rate.delete(k);
}
function accountName(value){
  const display=typeof value==='string'?value.trim():'';
  if(!/^[\p{L}\p{N}_-]{3,32}$/u.test(display))fail(400,'用户名需为 3–32 个字母、数字、汉字、下划线或短横线');
  return {display,username:display.toLocaleLowerCase()};
}
function credentials(input){
  const name=accountName(input.username);
  if(typeof input.password!=='string' || input.password.length<8 || input.password.length>128)fail(400,'密码需为 8–128 个字符');
  return {...name,password:input.password};
}
function registrationEmail(value){
  if(!emailRegistrationEnabled)fail(503,'邮箱注册暂未开通');
  const email=typeof value==='string'?value.trim().toLowerCase():'';
  if(email.length>254 || !/^[a-z0-9.!#$%&'*+/=?^_{|}~-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email))fail(400,'请输入有效邮箱地址');
  return email;
}
function codeDigest(invite,email,nonce,code){
  return createHmac('sha256',MAIL_KEY).update(JSON.stringify([invite,email,nonce,code])).digest();
}
async function sendRegistrationCode(req,payload){
  throttle(req,'email-code',10);
  const email=registrationEmail(payload.email);
  const invite=requireInvite(payload.inviteCode);
  const now=Date.now();
  const nonce=randomBytes(16).toString('hex');
  const code=String(randomInt(1000000)).padStart(6,'0');
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!sql.invite.get(invite.hash))fail(403,'邀请码无效或已使用，请联系管理员');
    if(sql.userByEmail.get(email))fail(409,'该邮箱已被注册');
    if(sql.registrationCode.get(invite.hash)?.created_at>now-EMAIL_CODE_COOLDOWN || sql.recentEmailCode.get(email,now-EMAIL_CODE_COOLDOWN))fail(429,'请等待 60 秒后再发送验证码');
    sql.putCode.run(invite.hash,email,nonce,codeDigest(invite.hash,email,nonce,code).toString('hex'),now);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  try{
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:'Bearer '+MAIL_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({from:MAIL_FROM,to:[email],subject:'知序注册验证码',text:'你的知序注册验证码为 '+code+'，10 分钟内有效。'}),
      signal:AbortSignal.timeout(8000)
    });
    await response.body?.cancel();
    if(!response.ok)throw new Error('mail delivery rejected');
  }catch{fail(502,'验证码暂时发送失败，请稍后重试');}
  if(!sql.markCodeSent.run(invite.hash,nonce).changes)fail(409,'验证码已更新，请重新获取');
}
function checkRegistrationCode(invite,email,value){
  const challenge=sql.registrationCode.get(invite);
  if(!challenge?.sent || challenge.email!==email || challenge.created_at<=Date.now()-EMAIL_CODE_AGE || challenge.attempts>=5)fail(400,'验证码无效或已过期，请重新获取');
  if(typeof value!=='string' || !/^\d{6}$/.test(value) || !timingSafeEqual(codeDigest(invite,email,challenge.nonce,value),Buffer.from(challenge.digest,'hex'))){
    sql.failCode.run(invite);
    return false;
  }
  return true;
}
function requireInvite(value){
  if(typeof value!=='string' || !/^[a-f0-9]{32}$/.test(value.trim()))fail(403,'邀请码无效或已使用，请联系管理员');
  const hash=hashToken(value.trim());
  const invite=sql.invite.get(hash);
  if(!invite || !catalog.banks.has(invite.subject))fail(403,'邀请码无效或已使用，请联系管理员');
  return {hash,subject:invite.subject};
}
function loadProgress(userId,ids){const row=sql.progress.get(userId);return {state:row?normalizeState(JSON.parse(row.state_json),ids):createState(),revision:row?.revision || 0};}
function applyEvent(state,event,ids){
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
function escapeLike(value){return value.replace(/[\\%_]/g,character=>'\\'+character);}
function userSummary(userId){
  const empty={answered:0,attempts:0,correct:0,accuracy:0,wrong:0,favorites:0,lastActive:null};
  const row=sql.progress.get(userId);
  if(!row)return empty;
  let state;
  try{state=JSON.parse(row.state_json);}catch{return empty;}
  if(!state || typeof state!=='object')return empty;
  const records=state.records && typeof state.records==='object'?state.records:{};
  let attempts=0,correct=0,wrong=0,lastActive=null;
  for(const record of Object.values(records)){
    if(!record || typeof record!=='object')continue;
    attempts+=Number(record.attempts)||0;
    correct+=Number(record.correctCount)||0;
    if(record.lastCorrect===false)wrong++;
    if(typeof record.lastAt==='string' && (!lastActive || record.lastAt>lastActive))lastActive=record.lastAt;
  }
  return {answered:Object.keys(records).length,attempts,correct,wrong,
    accuracy:attempts?Math.round(correct/attempts*100):0,
    favorites:Array.isArray(state.favorites)?state.favorites.length:0,lastActive};
}
function adminWhere(params){
  const q=(params.get('q') || '').trim().slice(0,64);
  const status=params.get('status') || 'all';
  const where=[],args=[];
  if(q){where.push("(username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')");args.push(`%${escapeLike(q)}%`,`%${escapeLike(q)}%`);}
  if(status==='active')where.push('disabled=0');
  if(status==='disabled')where.push('disabled=1');
  return {clause:where.length?` WHERE ${where.join(' AND ')}`:'',args};
}
function adminUserList(params){
  const {clause,args}=adminWhere(params);
  const page=Math.max(1,Number(params.get('page')) || 1);
  const size=Math.max(1,Math.min(100,Number(params.get('size')) || 20));
  const total=db.prepare(`SELECT COUNT(*) AS total FROM users${clause}`).get(...args).total;
  const rows=db.prepare(`SELECT id,username,display_name,created_at,last_login_at,disabled FROM users${clause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args,size,(page-1)*size);
  return {total,page,size,pages:Math.max(1,Math.ceil(total/size)),
    users:rows.map(row=>({...row,disabled:row.disabled===1,stats:userSummary(row.id)}))};
}
function csvCell(value){
  const text=value===null || value===undefined?'':String(value);
  return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}
function adminCsv(params){
  const {clause,args}=adminWhere(params);
  const rows=db.prepare(`SELECT id,username,display_name,created_at,last_login_at,disabled FROM users${clause} ORDER BY id ASC`).all(...args);
  const head=['id','用户名','注册时间','最近登录','状态','作答题目','作答次数','答对次数','正确率(%)','错题数','收藏数','最近学习'];
  const lines=[head.join(',')];
  for(const row of rows){
    const stats=userSummary(row.id);
    lines.push([row.id,row.display_name,row.created_at,row.last_login_at || '',
      row.disabled===1?'已禁用':'正常',stats.answered,stats.attempts,stats.correct,
      stats.accuracy,stats.wrong,stats.favorites,stats.lastActive || ''].map(csvCell).join(','));
  }
  return '\ufeff'+lines.join('\r\n')+'\r\n';
}
async function adminApi(req,res,route){
  const method=req.method;
  if(method==='POST' && route==='/api/admin/login'){
    const payload=await body(req);
    if(!adminConfigured())fail(403,'站点尚未设置管理密码（ADMIN_PASSWORD），请在 .env 中配置后重启服务');
    throttle(req,'admin-login',5);
    const supplied=typeof payload.password==='string'?payload.password:'';
    if(!supplied || supplied.length>256)fail(400,'请输入管理密码');
    const given=createHash('sha256').update(supplied).digest();
    const expected=createHash('sha256').update(ADMIN_PASSWORD).digest();
    if(!timingSafeEqual(given,expected))fail(401,'管理密码不正确');
    const token=randomBytes(32).toString('hex');
    sql.addAdminSession.run(hashToken(token),Date.now()+ADMIN_SESSION_AGE);
    res.setHeader('Set-Cookie',adminCookie(token));
    return json(res,200,{ok:true});
  }
  if(method==='POST' && route==='/api/admin/logout'){
    sql.deleteAdminSession.run(hashToken(getAdminToken(req)));
    res.setHeader('Set-Cookie',adminCookie('',0));
    return json(res,200,{ok:true});
  }
  if(!adminAuth(req))fail(401,'请先登录管理后台');
  if(method==='GET' && route==='/api/admin/me')return json(res,200,{ok:true,configured:adminConfigured()});
  if(method==='GET' && route==='/api/admin/subjects')return json(res,200,{subjects:catalog.subjects});
  if(method==='POST' && route==='/api/admin/invitations'){
    const {subject}=await body(req);
    if(!catalog.banks.has(subject))fail(400,'请选择有效科目');
    const code=randomBytes(16).toString('hex');
    sql.addInvite.run(hashToken(code),subject,new Date().toISOString());
    return json(res,201,{code,subject});
  }
  const params=new URL(req.url,'http://localhost').searchParams;
  if(method==='GET' && route==='/api/admin/users')return json(res,200,adminUserList(params));
  if(method==='GET' && route==='/api/admin/users.csv'){
    const csv=adminCsv(params);
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':`attachment; filename="zhixu-users-${new Date().toISOString().slice(0,10)}.csv"`,
      'Cache-Control':'no-store'});
    return res.end(csv);
  }
  const matched=route.match(/^\/api\/admin\/users\/(\d+)(?:\/(disable|enable|password|logout-all))?$/);
  if(matched){
    const id=Number(matched[1]),action=matched[2];
    const target=sql.userById.get(id);
    if(!target)fail(404,'账号不存在');
    if(method==='GET' && !action)return json(res,200,{user:{...target,disabled:target.disabled===1},stats:userSummary(id)});
    if(method==='POST' && action==='disable'){
      sql.setDisabled.run(1,id);sql.deleteUserSessions.run(id);
      return json(res,200,{ok:true,user:{...target,disabled:true}});
    }
    if(method==='POST' && action==='enable'){
      sql.setDisabled.run(0,id);
      return json(res,200,{ok:true,user:{...target,disabled:false}});
    }
    if(method==='POST' && action==='logout-all'){
      const removed=sql.deleteUserSessions.run(id).changes;
      return json(res,200,{ok:true,removed});
    }
    if(method==='POST' && action==='password'){
      const payload=await body(req);
      const password=typeof payload.newPassword==='string'?payload.newPassword:'';
      if(password.length<8 || password.length>128)fail(400,'新密码需为 8–128 个字符');
      const salt=randomBytes(16).toString('hex'),passwordHash=(await derive(password,salt,64)).toString('hex');
      sql.setPassword.run(salt,passwordHash,id);sql.deleteUserSessions.run(id);
      return json(res,200,{ok:true});
    }
    if(method==='DELETE' && !action){
      sql.deleteUser.run(id);
      return json(res,200,{ok:true});
    }
  }
  fail(404,'接口不存在');
}
async function api(req,res,route){
  if(req.method==='GET' && route==='/api/health')return json(res,200,{ok:true,total:catalog.all.total});
  if(req.method==='GET' && route==='/api/auth/me')return json(res,200,{user:auth(req) || null,emailRegistrationEnabled});
  if(req.method!=='GET')checkOrigin(req);
  if(route.startsWith('/api/admin/'))return await adminApi(req,res,route);
  if(req.method==='POST' && route==='/api/auth/email-code'){
    await sendRegistrationCode(req,await body(req));
    return json(res,200,{ok:true});
  }
  if(req.method==='POST' && ['/api/auth/register','/api/auth/login'].includes(route)){
    const payload=await body(req);
    const input=credentials(payload);throttle(req);throttle(req,input.username);
    const row=sql.user.get(input.username);
    if(route.endsWith('/register')){
      if(!registrationOpen)fail(403,'本站已关闭新账号注册');
      const invite=requireInvite(payload.inviteCode);
      const email=emailRegistrationEnabled?registrationEmail(payload.email):null;
      if(emailRegistrationEnabled && !payload.emailCode)fail(400,'请输入邮箱验证码');
      if(row)fail(409,'该用户名已被注册');
      const salt=randomBytes(16).toString('hex'), passwordHash=(await derive(input.password,salt,64)).toString('hex');
      db.exec('BEGIN IMMEDIATE');
      let id;
      try {
        const now=new Date().toISOString();
        if(email && sql.userByEmail.get(email))fail(409,'该邮箱已被注册');
        if(email && !checkRegistrationCode(invite.hash,email,payload.emailCode)){
          db.exec('COMMIT');
          return json(res,400,{error:'验证码不正确'});
        }
        if(!sql.consumeInvite.run(now,invite.hash).changes)fail(403,'邀请码无效或已使用，请联系管理员');
        sql.deleteCode.run(invite.hash);
        const result=sql.addUser.run(input.username,input.display,salt,passwordHash,now,invite.subject,email);
        id=Number(result.lastInsertRowid);sql.touchLogin.run(now,id);
        db.exec('COMMIT');
      } catch(e){
        db.exec('ROLLBACK');
        if(String(e.message).includes('UNIQUE'))fail(409,'该用户名已被注册');
        throw e;
      }
      sessionFor(id,res);return json(res,201,{user:{id,username:input.display,subject:invite.subject}});
    }
    const salt=row?.salt || '00000000000000000000000000000000';
    const candidate=await derive(input.password,salt,64);
    if(!row || !timingSafeEqual(candidate,Buffer.from(row.password_hash,'hex')))fail(401,'用户名或密码不正确');
    if(row.disabled)fail(403,'该账号已被管理员禁用，请联系管理员');
    sql.touchLogin.run(new Date().toISOString(),row.id);
    sessionFor(row.id,res);return json(res,200,{user:{id:row.id,username:row.display_name,subject:row.subject}});
  }
  const user=auth(req);if(!user)fail(401,'请先登录账号');
  const {ids,images,...bank}=catalog.forUser(user);
  if(req.method==='GET' && route==='/api/bank'){
    const coding=availableProblems(user).map(([id,problem])=>({id,...problem}));
    return json(res,200,{...bank,coding});
  }
  if(req.method==='POST' && route==='/api/coding/submit'){
    const {id,source}=await body(req);
    if(!availableProblems(user).some(([allowed])=>allowed===id))fail(404,'编程题不存在');
    if(typeof source!=='string' || !source.trim() || Buffer.byteLength(source)>32768)fail(400,'请输入不超过 32 KB 的 C 代码');
    throttle(req,'judge-'+user.id,20);
    return json(res,200,{result:await judge(id,source,DATA)});
  }
  if(req.method==='POST' && route==='/api/auth/logout'){
    sql.deleteSession.run(hashToken(getToken(req)));res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});
  }
  if(req.method==='POST' && route==='/api/auth/username'){
    throttle(req,'rename-'+user.id);
    const input=await body(req), name=accountName(input.username);
    if(typeof input.currentPassword!=='string' || input.currentPassword.length>128)fail(400,'请输入当前密码');
    const current=sql.userCredentials.get(user.id);
    if(!current)fail(409,'账号信息已更新，请刷新后重试');
    const candidate=await derive(input.currentPassword,current.salt,64);
    if(!timingSafeEqual(candidate,Buffer.from(current.password_hash,'hex')))fail(400,'当前密码不正确');
    try{
      if(!auth(req) || !sql.renameUser.run(name.username,name.display,user.id,current.password_hash).changes)fail(409,'账号信息已更新，请重新登录后重试');
    }catch(e){
      if(e.errcode===2067)fail(409,'该用户名已被注册');
      throw e;
    }
    return json(res,200,{user:{...user,username:name.display}});
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
  if(req.method==='GET' && route==='/api/progress')return json(res,200,loadProgress(user.id,ids));
  if(req.method==='POST' && route==='/api/progress/events'){
    const input=await body(req);if(!Array.isArray(input.events) || input.events.length>100)fail(400,'一次最多同步 100 条记录');
    db.exec('BEGIN IMMEDIATE');
    let current;
    try {
      current=loadProgress(user.id,ids);
      for(const event of input.events){
        const next=applyEvent(current.state,event,ids);
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
      const current=loadProgress(user.id,ids);if(input.revision!==current.revision)fail(409,'其他设备刚更新了进度，请同步后再操作');
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
    let filename=path.resolve(DIST,'.'+(route==='/'?'/index.html':route));
    if(!filename.startsWith(DIST+path.sep))fail(404,'文件不存在');
    let stat;try{stat=fs.statSync(filename);}catch{fail(404,'文件不存在');}
    if(stat.isDirectory()){
      if(!route.endsWith('/')){res.writeHead(308,{Location:(BASE || '')+route+'/'});return res.end();}
      filename=path.join(filename,'index.html');
      try{stat=fs.statSync(filename);}catch{fail(404,'文件不存在');}
    }
    if(!stat.isFile())fail(404,'文件不存在');
    const real=fs.realpathSync(filename);
    if(!real.startsWith(DIST_REAL+path.sep))fail(403,'文件访问被拒绝');
    const assetPath='/'+path.relative(DIST_REAL,real).split(path.sep).join('/');
    const protectedPath=assetPath.toLowerCase();
    if(protectedPath.startsWith('/data/'))fail(404,'文件不存在');
    const questionImage=protectedPath.startsWith('/assets/questions/');
    if(questionImage && !catalog.forUser(auth(req)).images?.has(assetPath))fail(404,'文件不存在');
    const ext=path.extname(filename),type=MIME[ext] || 'application/octet-stream';
    const etag=`"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    res.setHeader('Content-Type',type);
    res.setHeader('Cache-Control',questionImage?'private, no-store':['.html','.json','.js','.css'].includes(ext)?'no-cache':'public, max-age=604800');
    res.setHeader('ETag',etag);
    res.setHeader('Last-Modified',new Date(Math.floor(stat.mtimeMs/1000)*1000).toUTCString());
    res.setHeader('Vary','Accept-Encoding');
    if(route.startsWith('/admin'))res.setHeader('X-Robots-Tag','noindex, nofollow');
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
const cleanup=setInterval(()=>{const now=Date.now();db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now);db.prepare('DELETE FROM admin_sessions WHERE expires_at<?').run(now);db.prepare('DELETE FROM registration_codes WHERE created_at<?').run(now-EMAIL_CODE_AGE);},3600000);cleanup.unref();
function shutdown(){clearInterval(cleanup);server.close(()=>{db.close();process.exit(0);});setTimeout(()=>process.exit(0),5000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
