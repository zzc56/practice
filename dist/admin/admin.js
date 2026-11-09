const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
));
const formatTime = iso => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
};

const state = { q: '', status: 'all', page: 1, size: 20, total: 0, pages: 1, users: [] };

// 支持 BASE_PATH 子路径部署：页面在 /practice/admin/ 时，接口在 /practice/api/...
const BASE = location.pathname.replace(/\/admin\/?$/, '').replace(/\/$/, '');
const apiPath = path => BASE + path;

let toastTimer = 0;
function toast(message, kind = 'info') {
  const node = $('#toast');
  if (!node) return;
  node.textContent = message;
  node.className = `toast${kind === 'error' ? ' error' : ''}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3200);
}

async function request(path, { method = 'GET', body, redirectOn401 = true } = {}) {
  const response = await fetch(apiPath(path), {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'zhixu',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401 && redirectOn401) {
    showLogin('登录状态已过期，请重新登录');
    throw new Error('登录状态已过期');
  }
  const data = await response.json().catch(() => ({ error: '服务器返回了无法解析的内容' }));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

/* ---------- 登录 ---------- */

function showLogin(message = '') {
  const app = $('#app');
  app.className = '';
  app.innerHTML = `
    <div class="login-shell">
      <form class="login-card" id="login-form" autocomplete="off">
        <h1>管理后台</h1>
        <p>请输入管理密码，密码在服务器 .env 的 ADMIN_PASSWORD 中配置。</p>
        <div class="alert" id="login-error" ${message ? '' : 'hidden'}>${escapeHtml(message)}</div>
        <label class="field">
          <span>管理密码</span>
          <input type="password" id="login-password" name="password" autocomplete="current-password" required>
        </label>
        <button class="button block" type="submit" id="login-submit">登录</button>
      </form>
    </div>`;
  const form = $('#login-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#login-submit');
    const error = $('#login-error');
    const password = $('#login-password').value;
    if (!password) { error.textContent = '请输入管理密码'; error.hidden = false; return; }
    button.disabled = true;
    button.textContent = '登录中…';
    try {
      await request('/api/admin/login', { method: 'POST', body: { password }, redirectOn401: false });
      await start();
    } catch (caught) {
      error.textContent = caught.message || '登录失败';
      error.hidden = false;
      button.disabled = false;
      button.textContent = '登录';
    }
  });
  $('#login-password').focus();
}

/* ---------- 主界面 ---------- */

function showApp() {
  const app = $('#app');
  app.className = 'app-shell';
  app.innerHTML = `
    <div class="topbar">
      <h1>账号管理</h1>
      <span class="badge" id="total-badge">共 0 个账号</span>
      <span class="spacer"></span>
      <button class="button ghost" id="refresh">刷新</button>
      <button class="button ghost" id="logout">退出登录</button>
    </div>
    <div class="toolbar">
      <input type="search" id="search" placeholder="搜索用户名" aria-label="搜索用户名">
      <select id="status" aria-label="按状态筛选">
        <option value="all">全部状态</option>
        <option value="active">正常</option>
        <option value="disabled">已禁用</option>
      </select>
      <button class="button ghost" id="export">导出 CSV</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="num">ID</th>
              <th>用户名</th>
              <th>状态</th>
              <th class="num">作答</th>
              <th class="num">正确率</th>
              <th class="num">错题</th>
              <th class="num">收藏</th>
              <th>注册时间</th>
              <th>最近登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="rows"><tr><td colspan="10" class="empty">加载中…</td></tr></tbody>
        </table>
      </div>
      <div class="pager">
        <span class="info" id="pager-info"></span>
        <span class="buttons">
          <button class="button ghost" id="prev">上一页</button>
          <button class="button ghost" id="next">下一页</button>
        </span>
      </div>
    </div>`;

  $('#refresh').addEventListener('click', () => load().catch(error => toast(error.message, 'error')));
  $('#logout').addEventListener('click', async () => {
    await request('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin('已退出登录');
  });
  $('#search').addEventListener('input', debounce(event => {
    state.q = event.target.value.trim();
    state.page = 1;
    load().catch(error => toast(error.message, 'error'));
  }, 260));
  $('#status').addEventListener('change', event => {
    state.status = event.target.value;
    state.page = 1;
    load().catch(error => toast(error.message, 'error'));
  });
  $('#prev').addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
  $('#next').addEventListener('click', () => { if (state.page < state.pages) { state.page++; load(); } });
  $('#export').addEventListener('click', exportCsv);
  $('#rows').addEventListener('click', onRowAction);
}

function debounce(fn, wait) {
  let timer = 0;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

async function start() {
  showApp();
  try {
    await load();
  } catch (error) {
    showLogin(error.message);
  }
}

async function load() {
  const params = new URLSearchParams({ q: state.q, status: state.status, page: String(state.page), size: String(state.size) });
  const data = await request(`/api/admin/users?${params}`);
  state.users = data.users;
  state.total = data.total;
  state.pages = data.pages;
  if (state.page > state.pages) { state.page = state.pages; return load(); }
  renderRows();
}

function statusCell(user) {
  return user.disabled
    ? '<span class="status off">已禁用</span>'
    : '<span class="status on">正常</span>';
}

function renderRows() {
  const badge = $('#total-badge');
  if (badge) badge.textContent = `共 ${state.total} 个账号`;
  const body = $('#rows');
  if (!body) return;
  if (!state.users.length) {
    body.innerHTML = `<tr><td colspan="10" class="empty">${state.q || state.status !== 'all' ? '没有匹配的账号' : '还没有人注册'}</td></tr>`;
  } else {
    body.innerHTML = state.users.map(user => {
      const stats = user.stats || {};
      return `<tr data-id="${user.id}">
        <td class="num">${user.id}</td>
        <td><div class="username">${escapeHtml(user.display_name)}</div><div class="sub">${escapeHtml(user.username)}</div></td>
        <td>${statusCell(user)}</td>
        <td class="num">${stats.answered ?? 0}<div class="sub">${stats.attempts ?? 0} 次作答</div></td>
        <td class="num">${stats.attempts ? `${stats.accuracy}%` : '—'}</td>
        <td class="num">${stats.wrong ?? 0}</td>
        <td class="num">${stats.favorites ?? 0}</td>
        <td>${formatTime(user.created_at)}</td>
        <td>${formatTime(user.last_login_at)}</td>
        <td>
          <div class="row-actions">
            <button data-action="toggle">${user.disabled ? '启用' : '禁用'}</button>
            <button data-action="password">重置密码</button>
            <button data-action="kick">强制下线</button>
            <button data-action="delete" class="danger">删除</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }
  const info = $('#pager-info');
  if (info) info.textContent = `第 ${state.page} / ${state.pages} 页 · 共 ${state.total} 个账号`;
  const prev = $('#prev'), next = $('#next');
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= state.pages;
}

function userById(id) {
  return state.users.find(user => String(user.id) === String(id));
}

async function onRowAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('tr');
  const user = row ? userById(row.dataset.id) : null;
  if (!user) return;
  const action = button.dataset.action;
  button.disabled = true;
  try {
    if (action === 'toggle') {
      const target = user.disabled ? 'enable' : 'disable';
      const verb = user.disabled ? '启用' : '禁用';
      if (!await confirmDialog({
        title: `${verb}账号`,
        message: user.disabled
          ? `启用后「${user.display_name}」可以重新登录，学习记录保持不变。`
          : `禁用后「${user.display_name}」无法登录，已登录的设备会立即失效，学习记录保留。`,
        confirmText: verb,
        danger: !user.disabled,
      })) return;
      await request(`/api/admin/users/${user.id}/${target}`, { method: 'POST' });
      toast(`已${verb}「${user.display_name}」`);
    } else if (action === 'password') {
      const password = await promptDialog({
        title: '重置密码',
        message: `为「${user.display_name}」设置新密码，重置后该账号所有设备需要重新登录。`,
        label: '新密码（8–128 个字符）',
        inputType: 'password',
        minLength: 8,
      });
      if (!password) return;
      await request(`/api/admin/users/${user.id}/password`, { method: 'POST', body: { newPassword: password } });
      toast(`已重置「${user.display_name}」的密码`);
    } else if (action === 'kick') {
      if (!await confirmDialog({
        title: '强制下线',
        message: `清除「${user.display_name}」在所有设备上的登录状态，对方可以重新登录。`,
        confirmText: '强制下线',
      })) return;
      const data = await request(`/api/admin/users/${user.id}/logout-all`, { method: 'POST' });
      toast(data.removed ? `已清除 ${data.removed} 个登录会话` : '该账号当前没有登录会话');
    } else if (action === 'delete') {
      const typed = await promptDialog({
        title: '删除账号',
        message: `将从数据库中删除「${user.display_name}」的账号、密码和全部学习记录，此操作不可恢复。请输入用户名 ${user.username} 确认。`,
        label: '输入用户名确认',
        inputType: 'text',
        requireValue: user.username,
      });
      if (typed === null) return;
      await request(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      toast(`已删除「${user.display_name}」`);
      if (state.users.length === 1 && state.page > 1) state.page--;
    }
    await load();
  } catch (error) {
    toast(error.message || '操作失败', 'error');
  } finally {
    button.disabled = false;
  }
}

function exportCsv() {
  const params = new URLSearchParams({ q: state.q, status: state.status });
  const link = document.createElement('a');
  link.href = apiPath(`/api/admin/users.csv?${params}`);
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
  toast('正在导出 CSV');
}

/* ---------- 弹窗 ---------- */

function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  return root.querySelector('.modal');
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

function confirmDialog({ title, message, confirmText = '确定', danger = false }) {
  return new Promise(resolve => {
    const modal = openModal(`
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <div class="actions">
        <button class="button ghost" data-role="cancel">取消</button>
        <button class="button ${danger ? 'danger' : ''}" data-role="ok">${escapeHtml(confirmText)}</button>
      </div>`);
    const done = value => { closeModal(); resolve(value); };
    modal.querySelector('[data-role=cancel]').addEventListener('click', () => done(false));
    modal.querySelector('[data-role=ok]').addEventListener('click', () => done(true));
    modal.querySelector('[data-role=ok]').focus();
  });
}

function promptDialog({ title, message, label, inputType = 'text', minLength = 0, requireValue = null }) {
  return new Promise(resolve => {
    const modal = openModal(`
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <label class="field">
        <span>${escapeHtml(label)}</span>
        <input type="${inputType}" data-role="input" autocomplete="new-password">
      </label>
      <div class="alert" data-role="error" hidden></div>
      <div class="actions">
        <button class="button ghost" data-role="cancel">取消</button>
        <button class="button" data-role="ok">确定</button>
      </div>`);
    const input = modal.querySelector('[data-role=input]');
    const error = modal.querySelector('[data-role=error]');
    const submit = () => {
      const value = input.value.trim();
      if (requireValue !== null) {
        if (value !== requireValue) { error.textContent = '输入的用户名不一致'; error.hidden = false; return; }
      } else if (!value) {
        error.textContent = '请填写内容'; error.hidden = false; return;
      } else if (value.length < minLength) {
        error.textContent = `至少需要 ${minLength} 个字符`; error.hidden = false; return;
      }
      closeModal();
      resolve(value);
    };
    modal.querySelector('[data-role=cancel]').addEventListener('click', () => { closeModal(); resolve(null); });
    modal.querySelector('[data-role=ok]').addEventListener('click', submit);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
    input.focus();
  });
}

/* ---------- 启动 ---------- */

(async function boot() {
  try {
    await request('/api/admin/me', { redirectOn401: false });
    await start();
  } catch {
    showLogin();
  }
})();
