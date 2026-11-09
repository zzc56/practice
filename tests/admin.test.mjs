import {issueTestInvite} from '../tools/test-invite.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../', import.meta.url));

const ADMIN = 'admin-test-2026';

async function startBackend(t, extra = {}) {
  const taskTemp = await mkdtemp(path.join(tmpdir(), 'zhixu-admin-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: taskTemp, HOST: '127.0.0.1', PORT: '0', COOKIE_SECURE: 'false', ADMIN_PASSWORD: ADMIN, BASE_PATH: '', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit');
      child.kill();
      await ended;
    }
    await rm(taskTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timeout = setTimeout(() => reject(new Error(`后端启动超时：${errors}`)), 10000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); reject(new Error(`后端退出 ${code}: ${errors}`)); });
  });
}

function client(origin) {
  return async (route, { method = 'GET', body, cookie = '', headers = {} } = {}) => {
    const response = await fetch(origin + route, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'zhixu', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] || '', data };
  };
}

async function adminLogin(call) {
  const result = await call('/api/admin/login', { method: 'POST', body: { password: ADMIN } });
  assert.equal(result.status, 200, '管理密码正确时应登录成功');
  assert.match(result.cookie, /^zhixu_admin=/);
  return result.cookie;
}

test('未设置管理密码时后台不可用', async t => {
  const origin = await startBackend(t, { ADMIN_PASSWORD: '' });
  const call = client(origin);
  assert.equal((await call('/api/admin/me')).status, 401);
  const login = await call('/api/admin/login', { method: 'POST', body: { password: '' } });
  assert.equal(login.status, 403);
  assert.match(login.data.error, /管理密码/);
});

test('管理密码错误被拒绝，普通用户 Cookie 不能进入后台', async t => {
  const origin = await startBackend(t);
  const call = client(origin);
  const wrong = await call('/api/admin/login', { method: 'POST', body: { password: 'nope' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.cookie, '');
  const user = await call('/api/auth/register', { method: 'POST', body: { username: 'plain_user', password: 'Plain-Test-123', inviteCode: await issueTestInvite(origin,ADMIN) } });
  assert.equal(user.status, 201);
  assert.equal((await call('/api/admin/me', { cookie: user.cookie })).status, 401, '学员会话不能当管理会话用');
  assert.equal((await call('/api/admin/users', { cookie: user.cookie })).status, 401);
});

test('管理后台：列表、统计、禁用启用、改密、下线、删除与导出', async t => {
  const origin = await startBackend(t);
  const call = client(origin);
  const admin = await adminLogin(call);

  const created = await call('/api/auth/register', { method: 'POST', body: { username: 'student_one', password: 'Student-123', inviteCode: await issueTestInvite(origin,ADMIN) } });
  assert.equal(created.status, 201);
  const userCookie = created.cookie;
  const event = { id: 'admin-test-event-01', type: 'answer', questionId: 'E001', correct: true, graded: 'self', occurredAt: new Date().toISOString() };
  assert.equal((await call('/api/progress/events', { method: 'POST', cookie: userCookie, body: { events: [event] } })).status, 200);

  const list = await call('/api/admin/users', { cookie: admin });
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 1);
  const [row] = list.data.users;
  assert.equal(row.username, 'student_one');
  assert.equal(row.disabled, false);
  assert.equal(row.stats.answered, 1, '列表应带答题统计');
  assert.equal(row.stats.attempts, 1);

  const detail = await call(`/api/admin/users/${row.id}`, { cookie: admin });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.stats.correct, 1);

  // 禁用后无法登录，旧会话立即失效
  assert.equal((await call(`/api/admin/users/${row.id}/disable`, { method: 'POST', cookie: admin })).status, 200);
  assert.equal((await call('/api/progress', { cookie: userCookie })).status, 401, '禁用后旧会话应失效');
  const blocked = await call('/api/auth/login', { method: 'POST', body: { username: 'student_one', password: 'Student-123' } });
  assert.equal(blocked.status, 403);
  assert.match(blocked.data.error, /禁用/);

  // 启用后恢复
  assert.equal((await call(`/api/admin/users/${row.id}/enable`, { method: 'POST', cookie: admin })).status, 200);
  const relogin = await call('/api/auth/login', { method: 'POST', body: { username: 'student_one', password: 'Student-123' } });
  assert.equal(relogin.status, 200);

  // 重置密码：旧密码失效、新密码可用、旧会话被清空
  const reset = await call(`/api/admin/users/${row.id}/password`, { method: 'POST', cookie: admin, body: { newPassword: 'Reset-Test-456' } });
  assert.equal(reset.status, 200);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'student_one', password: 'Student-123' } })).status, 401);
  assert.equal((await call('/api/progress', { cookie: relogin.cookie })).status, 401, '重置密码后旧会话应失效');
  const newLogin = await call('/api/auth/login', { method: 'POST', body: { username: 'student_one', password: 'Reset-Test-456' } });
  assert.equal(newLogin.status, 200);
  assert.equal((await call(`/api/admin/users/${row.id}/password`, { method: 'POST', cookie: admin, body: { newPassword: 'short' } })).status, 400);

  // 强制下线
  const kick = await call(`/api/admin/users/${row.id}/logout-all`, { method: 'POST', cookie: admin });
  assert.equal(kick.status, 200);
  assert.ok(kick.data.removed >= 1);
  assert.equal((await call('/api/progress', { cookie: newLogin.cookie })).status, 401);

  // 搜索与筛选
  assert.equal((await call('/api/admin/users?q=student', { cookie: admin })).data.total, 1);
  assert.equal((await call('/api/admin/users?q=missing', { cookie: admin })).data.total, 0);
  assert.equal((await call('/api/admin/users?q=%25', { cookie: admin })).data.total, 0, 'LIKE 通配符需要转义');
  assert.equal((await call('/api/admin/users?status=disabled', { cookie: admin })).data.total, 0);

  // CSV 导出
  const csv = await call('/api/admin/users.csv', { cookie: admin });
  assert.equal(csv.status, 200);
  assert.match(csv.data, /用户名/);
  assert.match(csv.data, /student_one/);

  // 删除
  assert.equal((await call(`/api/admin/users/${row.id}`, { method: 'DELETE', cookie: admin })).status, 200);
  assert.equal((await call('/api/admin/users', { cookie: admin })).data.total, 0);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'student_one', password: 'Reset-Test-456' } })).status, 401);
});

test('管理后台页面可访问，未登录时后台接口一律 401', async t => {
  const origin = await startBackend(t);
  const page = await fetch(origin + '/admin', { redirect: 'manual' });
  assert.equal(page.status, 308);
  assert.equal(page.headers.get('location'), '/admin/');
  const index = await fetch(origin + '/admin/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(await index.text(), /管理后台/);
  assert.equal((await fetch(origin + '/admin/admin.js')).status, 200);
  for (const route of ['/api/admin/users', '/api/admin/users.csv', '/api/admin/me']) {
    assert.equal((await fetch(origin + route)).status, 401, `${route} 未登录必须 401`);
  }
});

test('子路径部署时管理后台挂在子路径下', async t => {
  const origin = await startBackend(t, { BASE_PATH: '/practice' });
  const redirect = await fetch(origin + '/practice/admin', { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/practice/admin/');
  assert.equal((await fetch(origin + '/practice/admin/')).status, 200);
  assert.equal((await fetch(origin + '/practice/admin/admin.js')).status, 200);
  assert.equal((await fetch(origin + '/api/admin/users')).status, 404, '子路径部署时根路径不再暴露接口');
  const call = client(origin);
  const login = await call('/practice/api/admin/login', { method: 'POST', body: { password: ADMIN } });
  assert.equal(login.status, 200);
  assert.equal((await call('/practice/api/admin/users', { cookie: login.cookie })).status, 200);
});

test('管理密码连续输错会被限流', async t => {
  const origin = await startBackend(t);
  const call = client(origin);
  let limited = 0;
  for (let index = 0; index < 8; index++) {
    const result = await call('/api/admin/login', { method: 'POST', body: { password: `wrong-${index}` } });
    if (result.status === 429) limited++;
  }
  assert.ok(limited > 0, '连续输错管理密码应触发 429');
});
