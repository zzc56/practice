import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../', import.meta.url));

async function startBackend(t, extra = {}) {
  const taskTemp = await mkdtemp(path.join(tmpdir(), 'zhixu-cache-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: taskTemp, HOST: '127.0.0.1', PORT: '0', COOKIE_SECURE: 'false', BASE_PATH: '', ...extra },
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

test('静态资源返回 ETag 与 Last-Modified，命中后返回 304', async t => {
  const origin = await startBackend(t);
  const first = await fetch(origin + '/app.js', { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  const modified = first.headers.get('last-modified');
  assert.match(etag || '', /^"[0-9a-f]+-[0-9a-f]+"$/, 'ETag 必须由大小与修改时间生成');
  assert.ok(modified, '必须返回 Last-Modified');
  assert.equal(first.headers.get('vary'), 'Accept-Encoding');
  await first.arrayBuffer();

  const byEtag = await fetch(origin + '/app.js', { headers: { 'If-None-Match': etag } });
  assert.equal(byEtag.status, 304, '带 If-None-Match 应返回 304');
  assert.equal(byEtag.headers.get('etag'), etag);

  const byDate = await fetch(origin + '/app.js', { headers: { 'If-Modified-Since': modified } });
  assert.equal(byDate.status, 304, '带 If-Modified-Since 应返回 304');

  const stale = await fetch(origin + '/app.js', { headers: { 'If-None-Match': '"stale-tag"' } });
  assert.equal(stale.status, 200, '不匹配的 ETag 必须返回完整内容');
  await stale.arrayBuffer();
});

test('文本资源按 Accept-Encoding 压缩，图片与已压缩内容不重复压缩', async t => {
  const origin = await startBackend(t);
  const gzipped = await fetch(origin + '/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(gzipped.status, 200);
  assert.equal(gzipped.headers.get('content-encoding'), 'gzip');
  assert.equal(gzipped.headers.get('vary'), 'Accept-Encoding');

  const plain = await fetch(origin + '/app.js', { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get('content-encoding'), null, 'identity 请求不得压缩');

  const png = await fetch(origin + '/favicon.svg', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(png.status, 200);
  await png.arrayBuffer();

  const head = await fetch(origin + '/app.js', { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-encoding'), 'gzip');
});

test('未开启 TRUSTED_PROXY 时忽略 X-Real-IP，开启后按该头区分访客', async t => {
  const attempts = async origin => {
    let limited = 0;
    for (let i = 0; i < 22; i++) {
      const response = await fetch(origin + '/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'zhixu',
          'X-Real-IP': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
        },
        body: JSON.stringify({ username: 'cache_probe', password: 'wrong-password' }),
      });
      if (response.status === 429) limited++;
    }
    return limited;
  };

  const untrusted = await startBackend(t);
  assert.ok(await attempts(untrusted) > 0, '未开启 TRUSTED_PROXY 时应按连接地址合并限流并触发 429');

  const trusted = await startBackend(t, { TRUSTED_PROXY: 'true' });
  assert.equal(await attempts(trusted), 0, '开启后每个 X-Real-IP 应有独立额度');
});
