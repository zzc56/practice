import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../', import.meta.url));
const TEST_INVITE = 'invite-test-2026-需要邀请';

async function startBackend(t, extraEnvironment = {}) {
  const taskTemp = await mkdtemp(path.join(tmpdir(), 'zhixu-backend-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: taskTemp, HOST: '127.0.0.1', PORT: '0', COOKIE_SECURE: 'false', ALLOW_REGISTRATION: 'true', INVITE_CODE: TEST_INVITE, BASE_PATH: '', ...extraEnvironment },
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
  const address = await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
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
  return address;
}

function api(origin, prefix = '') {
  return async (route, { method = 'GET', body, cookie = '', headers = {} } = {}) => {
    const response = await fetch(origin + prefix + route, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'zhixu', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
      headers: response.headers,
      data: await response.json(),
    };
  };
}

test('账号隔离、跨设备同步、事件重试、冲突与密码变更', async t => {
  const origin = await startBackend(t);
  const call = api(origin);
  const health = await call('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.total, 533);
  assert.equal((await call('/api/progress')).status, 401);

  const password = 'Practice-Test-123';
  const first = await call('/api/auth/register', { method: 'POST', body: { username: 'test_alpha', password, inviteCode: TEST_INVITE } });
  assert.equal(first.status, 201);
  assert.match(first.headers.get('set-cookie'), /HttpOnly/);
  assert.match(first.headers.get('set-cookie'), /SameSite=Lax/);
  const cookieA = first.cookie;
  const duplicate = await call('/api/auth/register', { method: 'POST', body: { username: 'TEST_ALPHA', password, inviteCode: TEST_INVITE } });
  assert.equal(duplicate.status, 409);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'test_alpha', password: 'wrong-123' } })).status, 401);
  const otherDevice = await call('/api/auth/login', { method: 'POST', body: { username: 'test_alpha', password } });
  assert.equal(otherDevice.status, 200);
  const cookieA2 = otherDevice.cookie;
  assert.notEqual(cookieA2, cookieA);

  const secondUser = await call('/api/auth/register', { method: 'POST', body: { username: 'test_beta', password, inviteCode: TEST_INVITE } });
  assert.equal(secondUser.status, 201);
  const cookieB = secondUser.cookie;
  const now = new Date().toISOString();
  const event = { id: 'test-answer-0001', type: 'answer', questionId: 'E001', correct: false, answer: [1], graded: 'self', occurredAt: now };
  const answered = await call('/api/progress/events', { method: 'POST', cookie: cookieA, body: { events: [event] } });
  assert.equal(answered.status, 200);
  assert.equal(answered.data.state.records.E001.attempts, 1);
  const repeated = await call('/api/progress/events', { method: 'POST', cookie: cookieA2, body: { events: [event] } });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.data.state.records.E001.attempts, 1);
  assert.equal(repeated.data.revision, answered.data.revision);
  const saved = await call('/api/progress/events', { method: 'POST', cookie: cookieA2, body: { events: [
    { id: 'test-favorite-0002', type: 'favorite', questionId: 'E001', value: true },
  ] } });
  assert.equal(saved.status, 200);
  const synced = await call('/api/progress', { cookie: cookieA });
  assert.equal(synced.data.state.records.E001.wrongCount, 1);
  assert.deepEqual(synced.data.state.favorites, ['E001']);
  const isolated = await call('/api/progress', { cookie: cookieB });
  assert.deepEqual(isolated.data.state.records, {});
  assert.deepEqual(isolated.data.state.favorites, []);

  const older = new Date(Date.now() - 3600000).toISOString();
  const late = await call('/api/progress/events', { method: 'POST', cookie: cookieA, body: { events: [
    { id: 'late-answer-0003', type: 'answer', questionId: 'E001', correct: true, graded: 'self', occurredAt: older },
  ] } });
  assert.equal(late.status, 200);
  assert.equal(late.data.state.records.E001.attempts, 2);
  assert.equal(late.data.state.records.E001.lastCorrect, false, '较早的离线作答不应覆盖较新的错题状态');
  const staleReset = await call('/api/progress/reset', { method: 'POST', cookie: cookieA2, body: { revision: 0 } });
  assert.equal(staleReset.status, 409);
  const badEvent = await call('/api/progress/events', { method: 'POST', cookie: cookieA, body: { events: [
    { id: 'bad-answer-0004', type: 'answer', questionId: 'nonexistent', correct: true },
  ] } });
  assert.equal(badEvent.status, 400);
  const crossSite = await call('/api/progress/events', { method: 'POST', cookie: cookieA, headers: { Origin: 'https://another.example' }, body: { events: [] } });
  assert.equal(crossSite.status, 403);
  const changed = await call('/api/auth/password', { method: 'POST', cookie: cookieA, body: { currentPassword: password, newPassword: 'Changed-Test-456' } });
  assert.equal(changed.status, 200);
  assert.ok(changed.cookie);
  assert.equal((await call('/api/auth/me', { cookie: cookieA2 })).data.user, null, '改密后应注销旧设备会话');
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'test_alpha', password } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'test_alpha', password: 'Changed-Test-456' } })).status, 200);
  const logout = await call('/api/auth/logout', { method: 'POST', cookie: changed.cookie, body: {} });
  assert.equal(logout.status, 200);
  assert.equal((await call('/api/progress', { cookie: changed.cookie })).status, 401);
});

test('子路径部署与 Secure Cookie 配置', async t => {
  const origin = await startBackend(t, { BASE_PATH: '/practice', COOKIE_SECURE: 'true' });
  const call = api(origin, '/practice');
  assert.equal((await fetch(origin + '/api/health')).status, 404);
  assert.equal((await fetch(origin + '/practice', { redirect: 'manual' })).status, 308);
  assert.equal((await fetch(origin + '/practice/')).status, 200);
  assert.match((await fetch(origin + '/practice/core.js')).headers.get('content-type'), /javascript/);
  const created = await call('/api/auth/register', { method: 'POST', body: { username: 'prefix_user', password: 'Prefix-Test-123', inviteCode: TEST_INVITE } });
  assert.equal(created.status, 201);
  assert.match(created.headers.get('set-cookie'), /; Secure/);
  assert.match(created.headers.get('set-cookie'), /Path=\/practice/);
});

test('邀请密码由后端验证，错误注册不创建账号，已有账号登录无需邀请密码', async t => {
  const origin = await startBackend(t);
  const call = api(origin);
  const credentials = { username: 'invited_user', password: 'Invited-Test-123' };
  for (const inviteCode of [undefined, '', 'wrong-invite', TEST_INVITE.toUpperCase(), ['wrong']]) {
    const denied = await call('/api/auth/register', { method: 'POST', body: { ...credentials, inviteCode } });
    assert.equal(denied.status, 403);
    assert.equal(denied.cookie, '', '验证失败不应生成登录会话');
  }
  assert.equal((await call('/api/auth/login', { method: 'POST', body: credentials })).status, 401);
  const created = await call('/api/auth/register', { method: 'POST', body: { ...credentials, inviteCode: TEST_INVITE } });
  assert.equal(created.status, 201, '之前被拒绝的尝试不应占用用户名');
  const login = await call('/api/auth/login', { method: 'POST', body: credentials });
  assert.equal(login.status, 200, '已有账号登录只需自己的用户名和密码');
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { ...credentials, inviteCode: 'not-needed-for-login' } })).status, 200);
  for (const route of ['/', '/app.js', '/account.js', '/data/questions.json']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes(TEST_INVITE), `${route} 不得泄露服务端邀请密码`);
  }
  for (const route of ['/server.mjs', '/.env', '/.env.example']) {
    assert.notEqual((await fetch(origin + route)).status, 200);
  }
});

test('未设邀请密码或主动关闭注册时拒绝新注册，网站仍可访问', async t => {
  for (const environment of [{ INVITE_CODE: '' }, { INVITE_CODE: '   ' }, { ALLOW_REGISTRATION: 'false' }]) {
    const origin = await startBackend(t, environment);
    const call = api(origin);
    const registration = await call('/api/auth/register', { method: 'POST', body: { username: 'blocked_user', password: 'Blocked-Test-123', inviteCode: TEST_INVITE } });
    assert.equal(registration.status, 403);
    assert.equal((await call('/api/health')).status, 200);
    assert.equal((await fetch(origin + '/')).status, 200);
  }
});
