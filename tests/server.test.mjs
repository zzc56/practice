import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStaticServer } from '../tools/serve.mjs';

test('预览服务器提供网页与正确的模块 MIME，拒绝越界、私有文件和写请求', async t => {
  const taskTemp = await mkdtemp(path.join(tmpdir(), 'zhixu-server-'));
  const root = path.join(taskTemp, 'dist');
  await mkdir(root);
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>知序</title>');
  await writeFile(path.join(root, 'app.js'), 'export const ready = true;');
  await writeFile(path.join(root, '.private'), 'private');
  await writeFile(path.join(taskTemp, 'secret.txt'), 'outside-secret');
  const server = createStaticServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(taskTemp, { recursive: true, force: true });
  });
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /知序/);
  const script = await fetch(`${origin}/app.js`);
  assert.match(script.headers.get('content-type'), /javascript/);
  const head = await fetch(`${origin}/app.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${origin}/missing`)).status, 404);
  assert.equal((await fetch(`${origin}/.private`)).status, 403);
  assert.equal((await fetch(`${origin}/app.js`, { method: 'POST' })).status, 405);
  const rawRequest = pathname => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject);
  });
  for (const pathname of ['/..%2fsecret.txt', '/%2e%2e%5csecret.txt', '/%00', '/%invalid']) {
    const response = await rawRequest(pathname);
    assert.notEqual(response.status, 200);
    assert.ok(!response.body.includes('outside-secret'));
  }
  try {
    await symlink(path.join(taskTemp, 'secret.txt'), path.join(root, 'escape.txt'));
    assert.equal((await fetch(`${origin}/escape.txt`)).status, 403);
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    t.diagnostic('系统不允许创建符号链接，已跳过该分支。');
  }
});
