/* 盈透copy Admin Console */
const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const TOKEN_KEY = 'et_admin_token';
const state = { view: 'dashboard', data: {} };

function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token()) headers.Authorization = 'Bearer ' + token();
  return fetch(path, { ...opts, headers }).then(async r => {
    if (r.status === 401) { logout(); throw new Error('登录已过期'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '请求失败');
    return j;
  });
}
function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = (type === 'success' ? '✓ ' : '✕ ') + msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtMoney(n) { return Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(s) { return s ? String(s).replace('T', ' ').slice(0, 16) : ''; }
function statusPill(s) {
  const map = { pending: ['amber','待审核'], approved: ['green','已通过'], rejected: ['red','已拒绝'], verified: ['green','已认证'], active: ['green','正常'], frozen: ['red','已冻结'], unverified: ['gray','未认证'], completed: ['green','已完成'] };
  const [c, l] = map[s] || ['gray', s];
  return `<span class="pill ${c}">${l}</span>`;
}
function logout() { localStorage.removeItem(TOKEN_KEY); render(); }

/* ---------- Render ---------- */
function render() {
  if (!token()) return renderLogin();
  renderLayout();
}
function renderLogin() {
  $('#app').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo"><div class="logo-box">ET</div><div><div class="login-title">盈透copy 管理后台</div></div></div>
        <div class="login-sub">智能量化交易与实体众筹投资平台 · 运营管理控制台</div>
        <form id="loginForm">
          <div class="field"><label>管理员账号</label><input name="username" placeholder="请输入账号" autocomplete="username" value="admin"></div>
          <div class="field"><label>密码</label><input name="password" type="password" placeholder="请输入密码" autocomplete="current-password"></div>
          <button class="btn full" type="submit">登 录</button>
        </form>
        
      </div>
    </div>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const j = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: f.get('username'), password: f.get('password') }) });
      setToken(j.token);
      toast('登录成功');
      render();
    } catch (err) { toast(err.message, 'error'); }
  });
}

const NAV = [
  ['dashboard', '📊', '数据看板'],
  ['users', '👥', '用户管理'],
  ['rooms', '🏠', '跟单房间'],
  ['projects', '📈', '众筹项目'],
  ['transactions', '💰', '充值提现'],
  ['settle', '💸', '收益结算'],
  ['kyc', '🪪', '实名审核'],
  ['commissions', '🔗', '推广收益'],
  ['quotes', '💹', '行情品种'],
  ['wallet', '🏦', '钱包配置'],
  ['team', '👑', '推荐团队'],
  ['notices', '📢', '通知发布'],
  ['support', '💬', '客服工单'],
  ['leads', '🎯', '带单审核'],
  ['content', '🖼️', '内容管理'],
  ['audit', '🧾', '审计日志'],
  ['settings', '⚙️', '系统设置'],
];
const NAV_TITLES = Object.fromEntries(NAV.map(n => [n[0], n[2]]));

function renderLayout() {
  const badges = {};
  ['transactions', 'kyc'].forEach(k => { badges[k] = state.data[k + '_badge'] || ''; });
  $('#app').innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="side-head"><div class="logo-box">ET</div><div><div class="t1">盈透copy</div><div class="t2">管理后台</div></div></div>
        <nav class="side-nav">
          ${NAV.map(([id, ic, lab]) => `<button class="nav-item ${state.view === id ? 'active' : ''}" data-nav="${id}"><span class="ic">${ic}</span><span class="lab">${lab}</span>${badges[id] ? `<span class="nav-badge">${badges[id]}</span>` : ''}</button>`).join('')}
        </nav>
        <div class="side-foot">
          <div class="user"><div class="av">A</div><span class="uname">admin</span></div>
          <button class="btn ghost sm" id="logoutBtn" style="width:100%;">退出登录</button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="page-title">${NAV_TITLES[state.view] || ''}</div>
          <div class="right">
            <div class="search-box"><span>🔍</span><input id="globalSearch" placeholder="搜索（用户/房间）..." onkeydown="if(event.key==='Enter'){globalSearchGo()}"></div>
            <button class="btn ghost sm" onclick="window.open('/','_blank')">查看前端 ↗</button>
          </div>
        </header>
        <main class="content" id="viewRoot"></main>
      </div>
    </div>`;
  fetch('/api/public/content').then(r => r.json()).then(c => {
    const logo = document.querySelector('.side-head .logo-box');
    const title = document.querySelector('.side-head .t1');
    if (logo && c.app_logo) logo.innerHTML = '<img src="' + esc(c.app_logo) + '" style="width:100%;height:100%;object-fit:contain;">';
    if (title && c.app_name) title.textContent = c.app_name;
  }).catch(() => {});
  $$('.nav-item').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.nav; renderLayout(); loadView(); }));
  $('#logoutBtn').addEventListener('click', logout);
  loadView();
}
function globalSearchGo() {
  const q = $('#globalSearch').value.trim();
  if (!q) return;
  state.view = 'users'; state.usersQ = q; renderLayout();
}

function loadView() {
  const root = $('#viewRoot');
  if (!root) return;
  root.innerHTML = '<div class="empty">加载中...</div>';
  const fn = { dashboard: loadDashboard, users: loadUsers, rooms: loadRooms, projects: loadProjects, transactions: loadTransactions, settle: loadSettle, kyc: loadKyc, commissions: loadCommissions, quotes: loadQuotes, wallet: loadWallet, team: loadTeam, notices: loadNotices, support: loadSupport, leads: loadLeads, content: loadContent, audit: loadAudit, settings: loadSettings }[state.view];
  if (fn) fn(root);
}/* ---------- Dashboard ---------- */
async function loadDashboard(root) {
  try {
    const s = await api('/api/dashboard/stats');
    state.data.transactions_badge = s.pendingDeposits + s.pendingWithdraws > 0 ? String(s.pendingDeposits + s.pendingWithdraws) : '';
    state.data.kyc_badge = s.pendingKyc > 0 ? String(s.pendingKyc) : '';
    root.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card accent"><div class="lab">👥 注册用户</div><div class="val">${s.totalUsers}</div><div class="sub">近7天新增 ${s.newUsers7d} 人</div></div>
        <div class="stat-card"><div class="lab">🏠 跟单房间</div><div class="val">${s.activeRooms}</div><div class="sub">全部运行中</div></div>
        <div class="stat-card green"><div class="lab">⬇️ 累计充值</div><div class="val">$${fmtMoney(s.totalDeposits)}</div><div class="sub">净流入 $${fmtMoney(s.netFlow)}</div></div>
        <div class="stat-card red"><div class="lab">⬆️ 累计提现</div><div class="val">$${fmtMoney(s.totalWithdraws)}</div><div class="sub">已审核通过</div></div>
        <div class="stat-card amber"><div class="lab">⏳ 待审核</div><div class="val">${s.pendingDeposits + s.pendingWithdraws}</div><div class="sub">充值 ${s.pendingDeposits} / 提现 ${s.pendingWithdraws}</div></div>
        <div class="stat-card"><div class="lab">🪪 待实名</div><div class="val">${s.pendingKyc}</div><div class="sub">待处理认证</div></div>
        <div class="stat-card green"><div class="lab">🔗 推广佣金</div><div class="val">$${fmtMoney(s.totalCommission)}</div><div class="sub">累计发放</div></div>
      </div>
      <div class="dash-grid">
        <div class="panel"><div class="panel-head"><h3>用户增长趋势</h3></div><div class="panel-body"><div class="chart-box" id="chartUsers"></div></div></div>
        <div class="panel"><div class="panel-head"><h3>充值趋势</h3></div><div class="panel-body"><div class="chart-box" id="chartDeposits"></div></div></div>
      </div>`;
    drawBars('chartUsers', s.userGrowth, '用户数');
    drawBars('chartDeposits', s.depositTrend, '充值额');
    ['transactions','kyc'].forEach(k => { if (state.data[k + '_badge']) { const el = document.querySelector('[data-nav=\"' + k + '\"] .nav-badge'); if (el) el.textContent = state.data[k + '_badge']; } });
  } catch (e) { root.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

function drawBars(id, rows, label) {
  const el = document.getElementById(id);
  if (!el) return;
  const vals = (rows || []).map(r => Number(r.c || r.s || 0));
  const labels = (rows || []).map(r => r.d);
  const max = Math.max(...vals, 1);
  el.innerHTML = `<div style="display:flex;align-items:flex-end;gap:6px;height:100%;padding-top:8px;">${vals.map((v, i) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;"><div style="width:70%;background:linear-gradient(180deg,#3b82f6,#004ac6);border-radius:6px 6px 0 0;height:${Math.max(2, v / max * 100)}%;min-height:2px;" title="${label}: ${v}"></div></div>`).join('')}</div>
    <div style="display:flex;gap:6px;margin-top:6px;">${labels.map(l => `<div style="flex:1;text-align:center;font-size:11px;color:#94a3b8;">${esc(l)}</div>`).join('')}</div>`;
}/* ---------- Users ---------- */
async function loadUsers(root) {
  try {
    const q = state.usersQ || '';
    const status = state.usersStatus || '';
    const url = '/api/users?q=' + encodeURIComponent(q) + '&status=' + encodeURIComponent(status);
    const users = await api(url);
    root.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>用户列表</h3><button class="btn sm" onclick="openUserModal()">+ 新增用户</button></div>
        <div class="panel-body">
          <div class="toolbar">
            <input type="text" placeholder="搜索姓名/手机/邮箱/UID" value="${esc(q)}" id="uSearch">
            <select id="uStatus">
              <option value="">全部状态</option>
              <option value="active" ${status==='active'?'selected':''}>正常</option>
              <option value="frozen" ${status==='frozen'?'selected':''}>冻结</option>
            </select>
            <button class="btn ghost sm" onclick="usersFilter()">筛选</button>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>UID</th><th>姓名</th><th>联系方式</th><th>资产</th><th>冻结</th><th>等级</th><th>密码状态</th><th>邀请码</th><th>实名</th><th>操作</th></tr></thead>
            <tbody>${users.map(u => `<tr>
              <td>${esc(u.uid)}</td><td><b>${esc(u.name)}</b></td><td>${esc(u.phone)}<br><span style="color:#94a3b8;font-size:12px;">${esc(u.email)}</span></td>
              <td>${fmtMoney(u.balance)}</td><td style="color:var(--amber)">${fmtMoney(u.frozen_balance || 0)}</td><td><span class="pill ${(u.user_level||'V1')==='V1'?'gray':'indigo'}">${esc(u.user_level || 'V1')}</span></td>
              <td><span class="pill green">bcrypt 加密</span></td><td>${esc(u.referral_code)}</td>
              <td>${statusPill(u.kyc_status)}</td>
              <td><div class="row-actions"><button class="btn xs ghost" onclick="openUserModal(${u.id})">编辑</button><button class="btn xs danger" onclick="delUser(${u.id},'${esc(u.name)}')">删除</button></div></td>
            </tr>`).join('') || '<tr><td colspan="10" class="empty">暂无用户</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
    $('#uSearch').addEventListener('keydown', e => { if (e.key === 'Enter') usersFilter(); });
    $('#uStatus').addEventListener('change', () => usersFilter());
  } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function usersFilter() {
  state.usersQ = $('#uSearch').value.trim();
  state.usersStatus = $('#uStatus').value;
  loadUsers($('#viewRoot'));
}
async function openUserModal(id) {
  let u = {};
  if (id) {
    const list = await api('/api/users');
    u = list.find(x => x.id === id) || {};
  }
  const html = `
    <div class="modal-mask" onclick="if(event.target===this)closeModal()"><div class="modal">
      <div class="modal-head"><h3>${id ? '编辑用户' : '新增用户'}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><form id="userForm" class="form-grid">
        <div class="field"><label>姓名</label><input name="name" value="${esc(u.name)}"></div>
        <div class="field"><label>手机号</label><input name="phone" value="${esc(u.phone)}"></div>
        <div class="field"><label>邮箱</label><input name="email" value="${esc(u.email)}"></div>
        <div class="field"><label>UID</label><input name="uid" value="${esc(u.uid)}" ${id ? 'disabled' : ''}></div>
        <div class="field"><label>余额(USD)</label><input name="balance" type="number" step="0.01" value="${u.balance ?? 0}"></div>
        <div class="field"><label>可用资金</label><input name="available" type="number" step="0.01" value="${u.available ?? u.balance ?? 0}"></div>
        <div class="field"><label>累计收益</label><input name="totalIncome" type="number" step="0.01" value="${u.total_income ?? 0}"></div>
        <div class="field"><label>状态</label><select name="status"><option value="active" ${u.status==='active'?'selected':''}>正常</option><option value="frozen" ${u.status==='frozen'?'selected':''}>冻结</option></select></div>
        <div class="field"><label>实名状态</label><select name="kycStatus"><option value="unverified" ${u.kyc_status==='unverified'?'selected':''}>未认证</option><option value="pending" ${u.kyc_status==='pending'?'selected':''}>待审核</option><option value="verified" ${u.kyc_status==='verified'?'selected':''}>已认证</option><option value="rejected" ${u.kyc_status==='rejected'?'selected':''}>已拒绝</option></select></div>
        <div class="field"><label>设置新密码</label><input name="password" type="password" value="" placeholder="留空则不修改；旧密码无法查看"></div>
        <div class="field"><label>等级</label><select name="userLevel"><option value="V1" ${(u.user_level||'V1')==='V1'?'selected':''}>V1</option><option value="V2" ${u.user_level==='V2'?'selected':''}>V2</option><option value="V3" ${u.user_level==='V3'?'selected':''}>V3</option><option value="V4" ${u.user_level==='V4'?'selected':''}>V4</option><option value="V5" ${u.user_level==='V5'?'selected':''}>V5</option></select></div>
        <div class="field"><label>冻结钱包(USD)</label><input name="frozenBalance" type="number" step="0.01" value="${u.frozen_balance ?? 0}"></div>
        <div class="field full"><label>邀请码</label><input name="referralCode" value="${esc(u.referral_code)}"></div>
      </form></div>
      <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveUser(${id || 0})">保存</button></div>
    </div></div>`;
  const mask = document.createElement('div'); mask.innerHTML = html; document.body.appendChild(mask.firstElementChild);
  const preview = $('#roomAvatarPreview');
  if (r.avatar) preview.innerHTML = '<img src="' + esc(r.avatar) + '" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:1px solid #e2e8f0;">';
  $('#roomAvatarFile').addEventListener('change', async function () {
    const file = this.files && this.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/admin/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: form });
    const data = await res.json();
    if (!res.ok) return toast(data.error || '上传失败', 'error');
    $('#roomAvatarUrl').value = data.url;
    preview.innerHTML = '<img src="' + esc(data.url) + '" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:1px solid #e2e8f0;">';
    toast('房间头像已上传');
  });
}
async function saveUser(id) {
  const f = new FormData($('#userForm'));
  const body = {
    name: f.get('name'), phone: f.get('phone'), email: f.get('email'),
    balance: Number(f.get('balance')), available: Number(f.get('available')), totalIncome: Number(f.get('totalIncome')),
    status: f.get('status'), kycStatus: f.get('kycStatus'), referralCode: f.get('referralCode'), password: f.get('password'), userLevel: f.get('userLevel'), frozenBalance: Number(f.get('frozenBalance'))
  };
  try {
    if (id) await api('/api/users/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
    toast('已保存'); closeModal(); loadView();
  } catch (e) { toast(e.message, 'error'); }
}
async function delUser(id, name) {
  if (!(await confirmDialog(`确认删除用户「${name}」？此操作不可恢复`))) return;
  try { await api('/api/users/' + id, { method: 'DELETE' }); toast('已删除'); loadView(); } catch (e) { toast(e.message, 'error'); }
}/* ---------- Rooms ---------- */
async function loadRooms(root) {
  try {
    const rooms = await api('/api/rooms');
    root.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>跟单房间 / 交易员策略</h3><button class="btn sm" onclick="openRoomModal()">+ 创建房间</button></div>
        <div class="panel-body">
          <div class="table-wrap"><table>
            <thead><tr><th>排序</th><th>交易员</th><th>标签</th><th>总利润</th><th>收益率</th><th>回撤</th><th>跟单人数</th><th>风格</th><th>热门</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${rooms.map(r => `<tr>
              <td>${r.sortOrder}</td>
              <td><div style="display:flex;align-items:center;gap:10px;"><img class="avatar-sm" src="${esc(r.avatar)}"><div><b>${esc(r.name)}</b><div style="color:#94a3b8;font-size:12px;">${esc(r.englishName)}</div></div></div></td>
              <td>${(r.tags || []).map(t => `<span class="pill blue" style="margin-right:4px;">${esc(t)}</span>`).join('')}</td>
              <td>$${fmtMoney(r.totalProfit)}</td><td>${r.yieldRate}%</td><td style="color:${r.maxDrawdown < 0 ? 'var(--red)' : 'inherit'}">${r.maxDrawdown}%</td>
              <td>${r.followersCount}</td><td>${esc(r.riskLevel)}</td>
              <td>${r.isHot ? '<span class="pill red">热门</span>' : '<span class="pill gray">—</span>'}</td>
              <td>${statusPill(r.status)}</td>
              <td><div class="row-actions"><button class="btn xs ghost" onclick="openRoomModal('${r.id}')">编辑</button><button class="btn xs ghost" onclick="toggleRoomHot('${r.id}')">${r.isHot ? '取消热门' : '设热门'}</button><button class="btn xs danger" onclick="delRoom('${r.id}','${esc(r.name)}')">删除</button></div></td>
            </tr>`).join('') || '<tr><td colspan="11" class="empty">暂无房间</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
  } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function openRoomModal(id) {
  let r = {};
  if (id) {
    const list = await api('/api/rooms');
    r = list.find(x => x.id === id) || {};
  }
  const tags = (r.tags || []).join(',');
  const dist = JSON.stringify(r.assetDistribution || [], null, 1);
  const sp = JSON.stringify(r.sparkline || []);
  const html = `
    <div class="modal-mask" onclick="if(event.target===this)closeModal()"><div class="modal wide">
      <div class="modal-head"><h3>${id ? '编辑房间' : '创建跟单房间'}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><form id="roomForm" class="form-grid">
        <div class="field"><label>房间ID</label><input name="id" value="${esc(r.id)}" ${id ? 'disabled' : ''}></div>
        <div class="field"><label>名称</label><input name="name" value="${esc(r.name)}"></div>
        <div class="field"><label>英文名</label><input name="englishName" value="${esc(r.englishName)}"></div>
        <div class="field"><label>房间头像</label><input type="file" id="roomAvatarFile" accept="image/*"><input type="hidden" name="avatar" id="roomAvatarUrl" value="${esc(r.avatar)}"><div id="roomAvatarPreview" style="margin-top:8px;"></div></div>
        <div class="field"><label>标签（逗号分隔）</label><input name="tags" value="${esc(tags)}"></div>
        <div class="field"><label>风险风格</label><input name="riskLevel" value="${esc(r.riskLevel)}"></div>
        <div class="field"><label>总利润(USD)</label><input name="totalProfit" type="number" step="0.01" value="${r.totalProfit ?? 0}"></div>
        <div class="field"><label>收益率(%)</label><input name="yieldRate" type="number" step="0.01" value="${r.yieldRate ?? 0}"></div>
        <div class="field"><label>最大回撤(%)</label><input name="maxDrawdown" type="number" step="0.01" value="${r.maxDrawdown ?? 0}"></div>
        <div class="field"><label>运行天数</label><input name="runningDays" type="number" value="${r.runningDays ?? 0}"></div>
        <div class="field"><label>跟单人数</label><input name="followersCount" type="number" value="${r.followersCount ?? 0}"></div>
        <div class="field"><label>管理规模</label><input name="totalAum" value="${esc(r.totalAum)}"></div>
        <div class="field"><label>胜率(%)</label><input name="winRate" type="number" step="0.1" value="${r.winRate ?? 0}"></div>
        <div class="field"><label>月回报(%)</label><input name="monthlyReturn" type="number" step="0.01" value="${r.monthlyReturn ?? 0}"></div>
        <div class="field"><label>分类</label><select name="category"><option value="forex" ${r.category==='forex'?'selected':''}>外汇</option><option value="crypto" ${r.category==='crypto'?'selected':''}>加密货币</option><option value="oil" ${r.category==='oil'?'selected':''}>原油</option></select></div>
        <div class="field"><label>排序</label><input name="sortOrder" type="number" value="${r.sortOrder ?? 0}"></div>
        <div class="field"><label>热门</label><select name="isHot"><option value="0" ${!r.isHot?'selected':''}>否</option><option value="1" ${r.isHot?'selected':''}>是</option></select></div>
        <div class="field"><label>日化收益率 下限%</label><input name="dailyYieldMin" type="number" step="0.01" value="${r.dailyYieldMin ?? 0.1}"></div>
        <div class="field"><label>日化收益率 上限%</label><input name="dailyYieldMax" type="number" step="0.01" value="${r.dailyYieldMax ?? 0.5}"></div>
        <div class="field"><label>绩效费 %（交易员分成）</label><input name="performanceFee" type="number" step="0.1" value="${r.performanceFee ?? 10}"></div>
        <div class="field"><label>交易员用户ID（可选）</label><input name="leaderUserId" type="number" value="${r.leaderUserId ?? ''}"></div>
        <div class="field full" style="font-size:12px;color:#64748b;background:#f1f5f9;padding:8px 12px;border-radius:8px;">💡 日化收益率：系统每天新加坡时间 06:00 为整个房间随机一个统一收益率，房间内所有跟单客户按同一收益率结算；基金池已取消。</div>
        <div class="field"><label>状态</label><select name="status"><option value="active" ${r.status!=='inactive'?'selected':''}>上架</option><option value="inactive" ${r.status==='inactive'?'selected':''}>下架</option></select></div>
        <div class="field full"><label>简介</label><textarea name="description">${esc(r.description)}</textarea></div>
        <div class="field full"><label>历史收益曲线 (JSON数组)</label><textarea name="sparkline" style="min-height:60px;">${esc(sp)}</textarea></div>
        <div class="field full"><label>持仓分布 (JSON)</label><textarea name="assetDistribution" style="min-height:120px;">${esc(dist)}</textarea></div>
      </form></div>
      <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveRoom('${id || ''}')">保存</button></div>
    </div></div>`;
  const mask = document.createElement('div'); mask.innerHTML = html; document.body.appendChild(mask.firstElementChild);
}
async function saveRoom(id) {
  const f = new FormData($('#roomForm'));
  let sparkline = []; let dist = [];
  try { sparkline = JSON.parse(f.get('sparkline') || '[]'); } catch { sparkline = String(f.get('sparkline')||'').split(',').map(Number).filter(n => !isNaN(n)); }
  try { dist = JSON.parse(f.get('assetDistribution') || '[]'); } catch { dist = []; }
  const body = {
    id: f.get('id') || undefined, name: f.get('name'), englishName: f.get('englishName'), avatar: f.get('avatar'),
    tags: String(f.get('tags')||'').split(',').map(s => s.trim()).filter(Boolean),
    riskLevel: f.get('riskLevel'), totalProfit: Number(f.get('totalProfit')), yieldRate: Number(f.get('yieldRate')),
    maxDrawdown: Number(f.get('maxDrawdown')), runningDays: Number(f.get('runningDays')), followersCount: Number(f.get('followersCount')),
    totalAum: f.get('totalAum'), winRate: Number(f.get('winRate')), monthlyReturn: Number(f.get('monthlyReturn')),
    category: f.get('category'), sortOrder: Number(f.get('sortOrder')), isHot: f.get('isHot') === '1', dailyYieldMin: Number(f.get('dailyYieldMin')), dailyYieldMax: Number(f.get('dailyYieldMax')), performanceFee: Number(f.get('performanceFee')), leaderUserId: f.get('leaderUserId') ? Number(f.get('leaderUserId')) : null,
    status: f.get('status'), description: f.get('description'), sparkline, assetDistribution: dist
  };
  try {
    if (id) await api('/api/rooms/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/rooms', { method: 'POST', body: JSON.stringify(body) });
    toast('已保存'); closeModal(); loadView();
  } catch (e) { toast(e.message, 'error'); }
}
async function toggleRoomHot(id) {
  try {
    const list = await api('/api/rooms');
    const r = list.find(x => x.id === id);
    await api('/api/rooms/' + id, { method: 'PUT', body: JSON.stringify({ isHot: !r.isHot }) });
    toast('已更新'); loadView();
  } catch (e) { toast(e.message, 'error'); }
}
async function delRoom(id, name) {
  if (!(await confirmDialog(`确认删除房间「${name}」？`))) return;
  try { await api('/api/rooms/' + id, { method: 'DELETE' }); toast('已删除'); loadView(); } catch (e) { toast(e.message, 'error'); }
}/* ---------- Projects ---------- */
async function loadProjects(root) {
  try {
    const ps = await api('/api/projects');
    root.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>众筹项目</h3><button class="btn sm" onclick="openProjectModal()">+ 新增项目</button></div>
        <div class="panel-body">
          <div class="table-wrap"><table>
            <thead><tr><th>项目</th><th>分类</th><th>进度</th><th>预估年化</th><th>目标金额</th><th>已募集</th><th>起投</th><th>退出路径</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${ps.map(p => `<tr>
              <td><div style="display:flex;align-items:center;gap:10px;"><img class="avatar-sm" style="border-radius:8px;" src="${esc(p.image)}"><b>${esc(p.title)}</b></div></td>
              <td>${esc(p.category)}</td><td>${p.progress}%</td><td>${p.estimated_yield}%</td><td>${esc(p.target_amount)}</td><td>${esc(p.raised_amount)}</td><td>$${fmtMoney(p.min_investment)}</td><td>${esc(p.exit_route)}</td>
              <td>${statusPill(p.status)}</td>
              <td><div class="row-actions"><button class="btn xs ghost" onclick="openProjectModal('${p.id}')">编辑</button><button class="btn xs danger" onclick="delProject('${p.id}','${esc(p.title)}')">删除</button></div></td>
            </tr>`).join('') || '<tr><td colspan="10" class="empty">暂无项目</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
  } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function openProjectModal(id) {
  let p = {};
  if (id) { const list = await api('/api/projects'); p = list.find(x => x.id === id) || {}; }
  const html = `
    <div class="modal-mask" onclick="if(event.target===this)closeModal()"><div class="modal">
      <div class="modal-head"><h3>${id ? '编辑项目' : '新增众筹项目'}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><form id="projectForm" class="form-grid">
        <div class="field"><label>ID</label><input name="id" value="${esc(p.id)}" ${id?'disabled':''}></div>
        <div class="field"><label>标题</label><input name="title" value="${esc(p.title)}"></div>
        <div class="field"><label>副标题</label><input name="subtitle" value="${esc(p.subtitle)}"></div>
        <div class="field"><label>图片URL</label><input name="image" value="${esc(p.image)}"></div>
        <div class="field"><label>分类</label><input name="category" value="${esc(p.category)}"></div>
        <div class="field"><label>进度(%)</label><input name="progress" type="number" step="0.1" value="${p.progress ?? 0}"></div>
        <div class="field"><label>预估年化(%)</label><input name="estimatedYield" type="number" step="0.1" value="${p.estimated_yield ?? 0}"></div>
        <div class="field"><label>目标金额</label><input name="targetAmount" value="${esc(p.target_amount)}"></div>
        <div class="field"><label>已募集</label><input name="raisedAmount" value="${esc(p.raised_amount)}"></div>
        <div class="field"><label>起投金额</label><input name="minInvestment" type="number" value="${p.min_investment ?? 0}"></div>
        <div class="field"><label>退出路径</label><input name="exitRoute" value="${esc(p.exit_route)}"></div>
        <div class="field"><label>团队背景</label><input name="team" value="${esc(p.team)}"></div>
        <div class="field"><label>状态</label><select name="status"><option value="active" ${p.status!=='inactive'?'selected':''}>上架</option><option value="inactive" ${p.status==='inactive'?'selected':''}>下架</option></select></div>
      </form></div>
      <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveProject('${id||''}')">保存</button></div>
    </div></div>`;
  const mask = document.createElement('div'); mask.innerHTML = html; document.body.appendChild(mask.firstElementChild);
}
async function saveProject(id) {
  const f = new FormData($('#projectForm'));
  const body = { id: f.get('id') || undefined, title: f.get('title'), subtitle: f.get('subtitle'), image: f.get('image'), category: f.get('category'), progress: Number(f.get('progress')), estimatedYield: Number(f.get('estimatedYield')), targetAmount: f.get('targetAmount'), raisedAmount: f.get('raisedAmount'), minInvestment: Number(f.get('minInvestment')), exitRoute: f.get('exitRoute'), team: f.get('team'), status: f.get('status') };
  try {
    if (id) await api('/api/projects/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    toast('已保存'); closeModal(); loadView();
  } catch (e) { toast(e.message, 'error'); }
}
async function delProject(id, name) {
  if (!(await confirmDialog(`确认删除项目「${name}」？`))) return;
  try { await api('/api/projects/' + id, { method: 'DELETE' }); toast('已删除'); loadView(); } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Transactions ---------- */
async function loadTransactions(root) {
  try {
    const status = state.txnStatus || 'pending';
    const type = state.txnType || '';
    const list = await api('/api/transactions?status=' + status + '&type=' + type);
    root.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>充值 / 提现审核</h3></div>
        <div class="panel-body">
          <div class="toolbar">
            <select id="txnStatus"><option value="pending" ${status==='pending'?'selected':''}>待审核</option><option value="approved" ${status==='approved'?'selected':''}>已通过</option><option value="rejected" ${status==='rejected'?'selected':''}>已拒绝</option><option value="" ${status===''?'selected':''}>全部</option></select>
            <select id="txnType"><option value="">全部类型</option><option value="deposit" ${type==='deposit'?'selected':''}>充值</option><option value="withdraw" ${type==='withdraw'?'selected':''}>提现</option></select>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>订单号</th><th>用户</th><th>充值UID</th><th>类型</th><th>金额(USD)</th><th>网络</th><th>充值地址/二维码</th><th>时间</th><th>状态</th><th>审核人</th><th>操作</th></tr></thead>
            <tbody>${list.map(t => `<tr>
              <td>${esc(t.txn_id)}</td><td><b>${esc(t.user_name)}</b></td>
              <td>${esc(t.deposit_uid || '—')}</td>
              <td>${t.type === 'deposit' ? '<span class="pill green">充值</span>' : '<span class="pill amber">提现</span>'}</td>
              <td><b>${fmtMoney(t.amount)}</b></td><td>${esc(t.network)}</td><td style="max-width:210px;"><div style="font-size:11px;word-break:break-all;">${esc(t.address) || '—'}</div>${t.type==='deposit' && t.payment_qr ? '<img src="' + esc(t.payment_qr) + '" style="width:52px;height:52px;object-fit:cover;border-radius:6px;margin-top:6px;border:1px solid #e2e8f0;">' : ''}</td>
              <td>${fmtDate(t.created_at)}</td><td>${statusPill(t.status)}</td><td>${esc(t.reviewed_by || '—')}</td>
              <td>${t.status === 'pending' ? `<div class="row-actions"><button class="btn xs green" onclick="reviewTxn(${t.id},'approve')">通过</button><button class="btn xs danger" onclick="reviewTxn(${t.id},'reject')">拒绝</button></div>` : '—'}</td>
            </tr>`).join('') || '<tr><td colspan="11" class="empty">暂无记录</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
    $('#txnStatus').addEventListener('change', () => { state.txnStatus = $('#txnStatus').value; loadView(); });
    $('#txnType').addEventListener('change', () => { state.txnType = $('#txnType').value; loadView(); });
  } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function reviewTxn(id, action) {
  const msg = action === 'approve' ? '确认通过该笔审核并更新用户余额？' : '确认拒绝该笔申请？';
  if (!(await confirmDialog(msg))) return;
  try { await api('/api/transactions/' + id + '/review', { method: 'PUT', body: JSON.stringify({ action }) }); toast('已处理'); loadView(); } catch (e) { toast(e.message, 'error'); }
}/* ---------- KYC ---------- */
async function loadKyc(root) {
  try {
    const status = state.kycStatus || 'pending';
    const list = await api('/api/kyc?status=' + status);
    root.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>实名认证审核</h3></div>
        <div class="panel-body">
          <div class="toolbar">
            <select id="kycStatus"><option value="pending" ${status==='pending'?'selected':''}>待审核</option><option value="verified" ${status==='verified'?'selected':''}>已通过</option><option value="rejected" ${status==='rejected'?'selected':''}>已拒绝</option><option value="" ${status===''?'selected':''}>全部</option></select>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>申请人</th><th>证件类型</th><th>证件号</th><th>姓名</th><th>提交时间</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${list.map(k => `<tr>
              <td><b>${esc(k.user_name)}</b><br><span style="color:#94a3b8;font-size:12px;">UID: ${esc(k.user_id)}</span></td>
              <td>${esc(k.kyc_type)}</td><td>${esc(k.id_number)}</td><td>${esc(k.real_name)}</td><td>${fmtDate(k.created_at)}</td>
              <td>${statusPill(k.status)}</td>
              <td><div class="row-actions"><button class="btn xs ghost" onclick="openKycDetail(${k.id})">查看</button>${k.status === 'pending' ? `<button class="btn xs green" onclick="reviewKyc(${k.id},'approve')">通过</button><button class="btn xs danger" onclick="reviewKyc(${k.id},'reject')">拒绝</button>` : ''}</div></td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">暂无记录</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
    $('#kycStatus').addEventListener('change', () => { state.kycStatus = $('#kycStatus').value; loadView(); });
  } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function openKycDetail(id) {
  const list = await api('/api/kyc?status=');
  const k = list.find(x => x.id === id);
  if (!k) return;
  const html = `
    <div class="modal-mask" onclick="if(event.target===this)closeModal()"><div class="modal">
      <div class="modal-head"><h3>实名认证详情</h3><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <div class="field"><label>申请人</label><div>${esc(k.user_name)}（用户ID: ${k.user_id}）</div></div>
        <div class="field"><label>证件类型</label><div>${esc(k.kyc_type)}</div></div>
        <div class="field"><label>证件号</label><div>${esc(k.id_number)}</div></div>
        <div class="field"><label>真实姓名</label><div>${esc(k.real_name)}</div></div>
        <div class="kyc-imgs">
          <div><div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">证件正面</div><img src="${esc(k.front_image)}" onclick="window.open('${esc(k.front_image)}','_blank')"></div>
          <div><div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">证件反面</div><img src="${esc(k.back_image)}" onclick="window.open('${esc(k.back_image)}','_blank')"></div>
          <div><div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">手持证件照</div><img src="${esc(k.handheld_image)}" onclick="window.open('${esc(k.handheld_image)}','_blank')"></div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">关闭</button>${k.status === 'pending' ? `<button class="btn green" onclick="reviewKyc(${k.id},'approve')">通过认证</button><button class="btn danger" onclick="reviewKyc(${k.id},'reject')">拒绝</button>` : ''}</div>
    </div></div>`;
  const mask = document.createElement('div'); mask.innerHTML = html; document.body.appendChild(mask.firstElementChild);
}
async function reviewKyc(id, action) {
  const msg = action === 'approve' ? '确认通过该实名认证？' : '确认拒绝该实名认证？';
  if (!(await confirmDialog(msg))) return;
  try { await api('/api/kyc/' + id + '/review', { method: 'PUT', body: JSON.stringify({ action }) }); toast('已处理'); closeModal(); loadView(); } catch (e) { toast(e.message, 'error'); }
}

/* ---------- V1-V5 promotion ---------- */
async function loadCommissions(root) {
  try {
    const levels = await api('/api/admin/agent-levels');
    const rewards = await api('/api/admin/promotion-rewards');
    const bonuses = await api('/api/admin/upgrade-bonuses');
    const paidRewards = rewards.reduce(function (sum, item) { return sum + Number(item.amount || 0); }, 0);
    const levelRows = levels.map(function (row) {
      return '<tr>' +
        '<td><b>V' + row.level + '</b></td>' +
        '<td>' + esc(row.level_name) + '</td>' +
        '<td><input id="agentDirect' + row.level + '" type="number" value="' + Number(row.direct_valid_required || 0) + '" style="width:70px"></td>' +
        '<td><input id="agentSmall' + row.level + '" type="number" step="0.01" value="' + Number(row.small_area_required || 0) + '" style="width:100px"></td>' +
        '<td><input id="agentV4' + row.level + '" type="number" value="' + Number(row.need_v4_count || 0) + '" style="width:60px"></td>' +
        '<td><input id="agentDirectRate' + row.level + '" type="number" step="0.1" value="' + (Number(row.direct_rate || 0) * 100).toFixed(2) + '" style="width:70px">%</td>' +
        '<td><input id="agentLotPrice' + row.level + '" type="number" step="0.01" value="' + Number(row.lot_price || 0) + '" style="width:70px"></td>' +
        '<td><input id="agentSameRate' + row.level + '" type="number" step="0.1" value="' + (Number(row.same_level_rate || 0) * 100).toFixed(2) + '" style="width:70px">%</td>' +
        '<td><input id="agentBonus' + row.level + '" type="number" step="0.01" value="' + Number(row.upgrade_bonus || 0) + '" style="width:80px"></td>' +
        '<td><button class="btn xs" onclick="saveAgentLevel(' + row.level + ')">保存</button></td>' +
      '</tr>';
    }).join('');
    const rewardNames = { direct_profit: '直推提成', lot_bonus: '小区手数奖', differential: '级差奖', same_level: '平级奖' };
    const rewardRows = rewards.slice(0, 50).map(function (item) {
      return '<tr><td>' + fmtDate(item.created_at) + '</td><td>' + esc(item.uid || '') + '<br><small>' + esc(item.name || '') + '</small></td><td>' + esc(rewardNames[item.reward_type] || item.reward_type) + '</td><td>' + Number(item.base_amount || 0).toFixed(2) + '</td><td>' + Number(item.standard_lots || 0).toFixed(4) + '</td><td>' + (Number(item.rate || 0) ? (Number(item.rate) * 100).toFixed(2) + '%' : '-') + '</td><td>' + Number(item.unit_price || 0) + '</td><td><b>' + Number(item.amount || 0).toFixed(4) + '</b></td><td>' + esc(item.remark || '') + '</td></tr>';
    }).join('');
    const bonusRows = bonuses.slice(0, 50).map(function (item) {
      return '<tr><td>' + esc(item.uid || '') + '<br><small>' + esc(item.name || '') + '</small></td><td>' + esc(item.from_level || '') + ' → ' + esc(item.to_level) + '</td><td>' + Number(item.amount || 0).toFixed(2) + '</td><td>' + esc({paid:'已发放',pending:'待发放',cancelled:'已失效'}[item.status] || item.status) + '</td><td>' + fmtDate(item.qualify_at || item.qualified_at) + '</td><td>' + fmtDate(item.hold_until) + '</td></tr>';
    }).join('');
    root.innerHTML = '<div class="stat-grid">' +
      '<div class="stat-card green"><div class="lab">推广奖励</div><div class="val">' + fmtMoney(paidRewards) + '</div><div class="sub">共 ' + rewards.length + ' 笔</div></div>' +
      '<div class="stat-card"><div class="lab">V1-V5 等级</div><div class="val">' + levels.length + '</div></div>' +
      '<div class="stat-card amber"><div class="lab">晋级奖励记录</div><div class="val">' + bonuses.length + '</div></div>' +
    '</div>' +
    '<div class="panel"><div class="panel-head"><h3>V1-V5 等级参数</h3></div><div style="padding:0 16px 12px;color:#64748b;font-size:12px;">手数奖每天按当前小区有效业绩计算：2000 USDT = 1标准手，按0.5手向下取整，不足2000 USDT不发放。示例：4000=2手，3000=1.5手，2800=1手。</div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>等级</th><th>名称</th><th>直推有效人数</th><th>小区业绩</th><th>需培育V4</th><th>直推提成</th><th>手数单价</th><th>平级奖</th><th>晋级奖</th><th>操作</th></tr></thead><tbody>' + levelRows + '</tbody></table></div></div></div>' +
    '<div class="panel"><div class="panel-head"><h3>每日推广奖励账单</h3></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>日期</th><th>用户</th><th>类型</th><th>基数</th><th>手数</th><th>比例</th><th>单价</th><th>金额</th><th>说明</th></tr></thead><tbody>' + (rewardRows || '<tr><td colspan="9" class="empty">暂无奖励</td></tr>') + '</tbody></table></div></div></div>' +
    '<div class="panel"><div class="panel-head"><h3>晋级奖励</h3></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>用户</th><th>等级变化</th><th>金额</th><th>状态</th><th>达标时间</th><th>可发放时间</th></tr></thead><tbody>' + (bonusRows || '<tr><td colspan="6" class="empty">暂无晋级奖励</td></tr>') + '</tbody></table></div></div></div>';
  } catch (e) { root.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}

async function saveAgentLevel(level) {
  const body = {
    directValidRequired: Number($('#agentDirect' + level).value),
    smallAreaRequired: Number($('#agentSmall' + level).value),
    needV4Count: Number($('#agentV4' + level).value),
    directRate: Number($('#agentDirectRate' + level).value) / 100,
    lotPrice: Number($('#agentLotPrice' + level).value),
    sameLevelRate: Number($('#agentSameRate' + level).value) / 100,
    upgradeBonus: Number($('#agentBonus' + level).value),
  };
  try { await api('/api/admin/agent-levels/' + level, { method: 'PUT', body: JSON.stringify(body) }); toast('V' + level + ' 参数已更新'); loadView(); } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Content ---------- */
async function loadContent(root) {
  try {
    const items = await api('/api/content');
    const g = (k) => items.find(i => i.key === k) || { key: k, value: '' };
    root.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>前端页面内容管理</h3><button class="btn sm" onclick="saveContent()">保存全部修改</button></div>
        <div class="panel-body">
          <h4 style="margin-bottom:12px;">🏠 首页</h4>
          <div class="form-grid">
            <div class="field"><label>平台名称</label><input data-k="app_name" value="${esc(g('app_name').value)}"></div>
            <div class="field"><label>平台标语</label><input data-k="app_slogan" value="${esc(g('app_slogan').value)}"></div>
            <div class="field full"><label>首页Banner标题</label><input data-k="home_banner_title" value="${esc(g('home_banner_title').value)}"></div>
            <div class="field full"><label>首页Banner副标题</label><input data-k="home_banner_subtitle" value="${esc(g('home_banner_subtitle').value)}"></div>
            <div class="field full"><label>Banner图片URL</label><input data-k="home_banner_image" value="${esc(g('home_banner_image').value)}"><div style="margin-top:6px;"><img src="${esc(g('home_banner_image').value)}" style="max-width:220px;border-radius:8px;border:1px solid var(--line);"></div></div>
            <div class="field"><label>热门专区标题</label><input data-k="hot_section_title" value="${esc(g('hot_section_title').value)}"></div>
            <div class="field"><label>热门标签文字</label><input data-k="hot_section_tag" value="${esc(g('hot_section_tag').value)}"></div>
          </div>
          <h4 style="margin:18px 0 12px;">📈 众筹页</h4>
          <div class="form-grid">
            <div class="field"><label>众筹标题</label><input data-k="crowdfunding_title" value="${esc(g('crowdfunding_title').value)}"></div>
            <div class="field full"><label>众筹副标题</label><input data-k="crowdfunding_subtitle" value="${esc(g('crowdfunding_subtitle').value)}"></div>
          </div>
          <h4 style="margin:18px 0 12px;">🤝 推广页</h4>
          <div class="form-grid">
            <div class="field"><label>推广标题</label><input data-k="referral_title" value="${esc(g('referral_title').value)}"></div>
            <div class="field full"><label>推广描述</label><input data-k="referral_desc" value="${esc(g('referral_desc').value)}"></div>
          </div>
          <h4 style="margin:18px 0 12px;">💰 充值提现</h4>
          <div class="form-grid">
            <div class="field"><label>充值提示</label><input data-k="deposit_notice" value="${esc(g('deposit_notice').value)}"></div>
            <div class="field"><label>提现提示</label><input data-k="withdraw_notice" value="${esc(g('withdraw_notice').value)}"></div>
          </div>
        </div>
      </div>`;
  const logoWrap = document.createElement('div');
  logoWrap.className = 'panel';
  logoWrap.innerHTML = '<div class="panel-head"><h3>项目 LOGO</h3></div><div class="panel-body"><input id="logoUrlInput" placeholder="上传后自动填入 URL" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;"><input id="logoFileInput" type="file" accept="image/*" style="margin-top:10px"><div id="logoPreviewBox" style="margin-top:10px"></div></div>';
  root.prepend(logoWrap);
  const logoItem = items.find(i => i.key === 'app_logo') || { key: 'app_logo', value: '' };
  $('#logoUrlInput').dataset.k = 'app_logo';
  $('#logoUrlInput').value = logoItem.value || '';
  if (logoItem.value) $('#logoPreviewBox').innerHTML = '<img src="' + esc(logoItem.value) + '" style="max-width:120px;max-height:80px;border-radius:8px;border:1px solid var(--line);">';
  $('#logoFileInput').addEventListener('change', async function () {
    const file = this.files && this.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await fetch('/api/admin/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '上传失败');
      $('#logoUrlInput').value = data.url;
      $('#logoPreviewBox').innerHTML = '<img src="' + esc(data.url) + '" style="max-width:120px;max-height:80px;border-radius:8px;border:1px solid var(--line);">';
      toast('Logo 已上传，点击保存全部修改后生效');
    } catch (e) { toast(e.message, 'error'); }
  });
  } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function saveContent() {
  const items = $$('[data-k]').map(el => ({ key: el.dataset.k, value: el.value, type: 'text' }));
  try { await api('/api/content', { method: 'PUT', body: JSON.stringify({ items }) }); toast('内容已更新，前端刷新后生效'); } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Settle (收益结算) ---------- */
async function loadSettle(root) {
  try {
    const yields = await api('/api/admin/yields');
    const totalProfit = yields.reduce((s, y) => s + Number(y.profit || 0), 0);
    const totalCustomer = yields.reduce((s, y) => s + Number(y.customer_share || 0), 0);
    const totalTrader = yields.reduce((s, y) => s + Number(y.trader_share || 0), 0);
    const totalFund = yields.reduce((s, y) => s + Number(y.fund_share || 0), 0);
    root.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card green"><div class="lab">💰 累计结算收益</div><div class="val">${totalProfit.toFixed(2)}</div><div class="sub">共 ${yields.length} 笔</div></div>
        <div class="stat-card accent"><div class="lab">👤 客户所得</div><div class="val">${totalCustomer.toFixed(2)}</div></div>
        <div class="stat-card amber"><div class="lab">🏦 交易员绩效</div><div class="val">${totalTrader.toFixed(2)}</div></div>
        
      </div>
      <div class="panel">
        <div class="panel-head"><h3>日化收益结算</h3><button class="btn sm" onclick="manualSettle()">⚡ 立即结算</button></div>
        <div class="panel-body" style="font-size:13px;color:#475569;line-height:1.8;">
          <div>· 系统每天新加坡时间 <b>06:00</b> 自动为每个房间确定一个统一收益率，并为房间内所有跟单结算；</div>
          <div>· 分配比例：收益先扣除交易员绩效费，其余全部进入客户可用余额；基金池已取消。</div>
          <div>· 点击「立即结算」可手动触发（幂等：同一跟单每天仅结算一次）。</div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>收益流水</h3></div>
        <div class="panel-body">
          <div class="table-wrap"><table>
            <thead><tr><th>ID</th><th>用户</th><th>房间</th><th>本金</th><th>当日统一收益率</th><th>收益</th><th>交易员绩效费</th><th>客户到账</th><th>结算日</th></tr></thead>
            <tbody>${yields.map(y => `<tr>
              <td>${y.id}</td><td>${esc(y.uid)}</td><td>${esc(y.room_name)}</td>
              <td>${y.principal}</td><td>${y.yield_rate}%</td><td><b>${Number(y.profit).toFixed(4)}</b></td>
              <td>${Number(y.trader_share).toFixed(4)}</td><td style="color:var(--green)">${Number(y.customer_share).toFixed(4)}</td>
              <td>${esc(y.settle_date)}</td>
            </tr>`).join('') || '<tr><td colspan="9" class="empty">暂无结算记录，点击「立即结算」试试</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
  } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function manualSettle() {
  try { await api('/api/admin/settle?force=1', { method: 'POST' }); toast('结算完成'); loadView(); } catch (e) { toast(e.message, 'error'); }
}
/* ---------- Quotes (行情品种) ---------- */
async function loadQuotes(root) {
  try {
    const qs = await api('/api/admin/quotes');
    root.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>交易品种管理</h3><div style="display:flex;gap:8px;"><button class="btn ghost sm" onclick="refreshQuotes()">🔄 刷新实时行情</button><button class="btn sm" onclick="openQuoteModal()">+ 新增品种</button></div></div>
        <div class="panel-body">
          <div class="table-wrap"><table>
            <thead><tr><th>代码</th><th>名称</th><th>最新价</th><th>分类</th><th>API源ID</th><th>操作</th></tr></thead>
            <tbody>${qs.map(q => `<tr>
              <td><b>${esc(q.symbol)}</b></td><td>${esc(q.name)}</td><td>${Number(q.price).toLocaleString('en-US',{maximumFractionDigits:4})}</td>
              <td><span class="pill blue">${esc(q.category)}</span></td><td>${esc(q.api_id || '—')}</td>
              <td><div class="row-actions"><button class="btn xs ghost" onclick="openQuoteModal('${esc(q.symbol)}')">编辑</button><button class="btn xs danger" onclick="delQuote('${esc(q.symbol)}')">删除</button></div></td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty">暂无品种</td></tr>'}</tbody>
          </table></div>
          <div style="font-size:12px;color:#64748b;margin-top:10px;">💡 分类为 crypto 且填写了「API源ID」（如 bitcoin/ethereum/solana）的品种会通过 CoinGecko 免费接口每 5 分钟自动刷新真实价格并记录走势。其他品种可在后台手动改价。</div>
        </div>
      </div>`;
  } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function refreshQuotes() {
  try { const j = await api('/api/admin/quotes/refresh', { method: 'POST' }); toast('已刷新 ' + j.updated + ' 个品种'); loadView(); } catch (e) { toast(e.message, 'error'); }
}
async function openQuoteModal(symbol) {
  let q = {};
  if (symbol) { const list = await api('/api/admin/quotes'); q = list.find(x => x.symbol === symbol) || {}; }
  const html = `
    <div class="modal-mask" onclick="if(event.target===this)closeModal()"><div class="modal">
      <div class="modal-head"><h3>${symbol ? '编辑品种' : '新增品种'}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><form id="quoteForm" class="form-grid">
        <div class="field"><label>代码（如 BTC/USDT、XAUUSD）</label><input name="symbol" value="${esc(q.symbol)}" ${symbol?'disabled':''}></div>
        <div class="field"><label>名称</label><input name="name" value="${esc(q.name)}"></div>
        <div class="field"><label>最新价</label><input name="price" type="number" step="0.0001" value="${q.price ?? 0}"></div>
        <div class="field"><label>分类</label><select name="category"><option value="precious" ${q.category==='precious'?'selected':''}>贵金属</option><option value="crypto" ${q.category==='crypto'?'selected':''}>加密货币</option><option value="oil" ${q.category==='oil'?'selected':''}>原油</option><option value="forex" ${q.category==='forex'?'selected':''}>外汇</option></select></div>
        <div class="field full"><label>API源ID（仅加密币，CoinGecko 代码）</label><input name="apiId" value="${esc(q.api_id || '')}" placeholder="如 bitcoin / ethereum / solana"></div>
      </form></div>
      <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveQuote('${symbol || ''}')">保存</button></div>
    </div></div>`;
  const mask = document.createElement('div'); mask.innerHTML = html; document.body.appendChild(mask.firstElementChild);
}
async function saveQuote(symbol) {
  const f = new FormData($('#quoteForm'));
  const body = { symbol: f.get('symbol'), name: f.get('name'), price: Number(f.get('price')), category: f.get('category'), apiId: f.get('apiId') };
  try {
    if (symbol) await api('/api/admin/quotes/' + encodeURIComponent(symbol), { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/admin/quotes', { method: 'POST', body: JSON.stringify(body) });
    toast('已保存'); closeModal(); loadView();
  } catch (e) { toast(e.message, 'error'); }
}
async function delQuote(symbol) {
  if (!(await confirmDialog('确认删除品种 ' + symbol + ' ？'))) return;
  try { await api('/api/admin/quotes/' + encodeURIComponent(symbol), { method: 'DELETE' }); toast('已删除'); loadView(); } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Wallet (多充值地址池) ---------- */
async function loadWallet(root) {
  try {
    const addresses = await api('/api/admin/deposit-addresses');
    const contents = await api('/api/content');
    const notice = (contents.find(i => i.key === 'deposit_notice') || {}).value || '';
    const rows = addresses.map(function (a) {
      return '<tr>' +
        '<td><b>' + esc(a.network) + '</b></td>' +
        '<td>' + esc(a.currency) + '</td>' +
        '<td style="max-width:240px;word-break:break-all;">' + esc(a.address) + '</td>' +
        '<td>' + (a.qr_url ? '<img src="' + esc(a.qr_url) + '" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;">' : '—') + '</td>' +
        '<td>' + statusPill(a.status) + '</td>' +
        '<td>' + Number(a.sort_order || 0) + '</td>' +
        '<td><div class="row-actions"><button class="btn xs ghost" onclick="openDepositAddressModal(' + a.id + ')">编辑</button><button class="btn xs danger" onclick="deleteDepositAddress(' + a.id + ')">删除</button></div></td>' +
      '</tr>';
    }).join('');
    root.innerHTML = '<div class="panel">' +
      '<div class="panel-head"><h3>多充币地址与二维码</h3><button class="btn sm" onclick="openDepositAddressModal(0)">+ 新增充值地址</button></div>' +
      '<div class="panel-body"><div style="font-size:12px;color:#64748b;margin-bottom:12px;">同一网络可以绑定多个地址。客户每次进入充值页或点击“换一个充值地址”时，系统会随机切换一个启用中的地址及对应二维码。</div>' +
      '<div class="table-wrap"><table><thead><tr><th>网络</th><th>币种</th><th>充值地址</th><th>二维码</th><th>状态</th><th>排序</th><th>操作</th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="empty">暂无充值地址</td></tr>') + '</tbody></table></div></div></div>' +
      '<div class="panel"><div class="panel-head"><h3>充值提示</h3><button class="btn sm" onclick="saveWalletNotice()">保存提示</button></div><div class="panel-body"><div class="field"><textarea id="depositNotice" rows="3">' + esc(notice) + '</textarea></div></div></div>';
  } catch (e) { root.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}

async function saveWalletNotice() {
  try {
    await api('/api/content', { method: 'PUT', body: JSON.stringify({ items: [{ key: 'deposit_notice', value: $('#depositNotice').value, type: 'text' }] }) });
    toast('充值提示已保存');
  } catch (e) { toast(e.message, 'error'); }
}

async function openDepositAddressModal(id) {
  let row = { network: 'TRC20', currency: 'USDT', address: '', qr_url: '', status: 'active', sort_order: 0 };
  if (id) {
    const list = await api('/api/admin/deposit-addresses');
    row = list.find(function (item) { return Number(item.id) === Number(id); }) || row;
  }
  const html = '<div class="modal-mask" onclick="if(event.target===this)closeModal()"><div class="modal">' +
    '<div class="modal-head"><h3>' + (id ? '编辑充值地址' : '新增充值地址') + '</h3><button class="modal-close" onclick="closeModal()">×</button></div>' +
    '<div class="modal-body"><div class="form-grid">' +
      '<div class="field"><label>网络</label><select id="depositNetwork"><option value="TRC20"' + (row.network === 'TRC20' ? ' selected' : '') + '>TRC20</option><option value="ERC20"' + (row.network === 'ERC20' ? ' selected' : '') + '>ERC20</option><option value="BSC"' + (row.network === 'BSC' ? ' selected' : '') + '>BSC</option></select></div>' +
      '<div class="field"><label>币种</label><select id="depositCurrency"><option value="USDT"' + (row.currency === 'USDT' ? ' selected' : '') + '>USDT</option><option value="ETH"' + (row.currency === 'ETH' ? ' selected' : '') + '>ETH</option><option value="BNB"' + (row.currency === 'BNB' ? ' selected' : '') + '>BNB</option></select></div>' +
      '<div class="field full"><label>充值地址</label><input id="depositAddress" value="' + esc(row.address) + '" placeholder="请输入充值地址"></div>' +
      '<div class="field full"><label>地址二维码</label><input id="depositQrFile" type="file" accept="image/*"><input id="depositQrUrl" type="hidden" value="' + esc(row.qr_url || '') + '"><div id="depositQrPreview" style="margin-top:8px;">' + (row.qr_url ? '<img src="' + esc(row.qr_url) + '" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;">' : '') + '</div></div>' +
      '<div class="field"><label>状态</label><select id="depositStatus"><option value="active"' + (row.status === 'active' ? ' selected' : '') + '>启用</option><option value="inactive"' + (row.status !== 'active' ? ' selected' : '') + '>停用</option></select></div>' +
      '<div class="field"><label>排序</label><input id="depositSort" type="number" value="' + Number(row.sort_order || 0) + '"></div>' +
    '</div></div>' +
    '<div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveDepositAddress(' + (id || 0) + ')">保存</button></div>' +
  '</div></div>';
  const mask = document.createElement('div');
  mask.innerHTML = html;
  document.body.appendChild(mask.firstElementChild);
  $('#depositQrFile').addEventListener('change', async function () {
    const file = this.files && this.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/admin/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');
      $('#depositQrUrl').value = data.url;
      $('#depositQrPreview').innerHTML = '<img src="' + esc(data.url) + '" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;">';
      toast('二维码已上传');
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function saveDepositAddress(id) {
  const body = {
    network: $('#depositNetwork').value,
    currency: $('#depositCurrency').value,
    address: $('#depositAddress').value.trim(),
    qrUrl: $('#depositQrUrl').value,
    status: $('#depositStatus').value,
    sortOrder: Number($('#depositSort').value || 0),
  };
  if (!body.address) return toast('请输入充值地址', 'error');
  try {
    if (id) await api('/api/admin/deposit-addresses/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/admin/deposit-addresses', { method: 'POST', body: JSON.stringify(body) });
    toast('充值地址已保存');
    closeModal();
    loadView();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteDepositAddress(id) {
  if (!(await confirmDialog('确认删除该充值地址？删除后不会再被随机分配。'))) return;
  try { await api('/api/admin/deposit-addresses/' + id, { method: 'DELETE' }); toast('已删除'); loadView(); } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Team (推荐团队) ---------- */
async function loadTeam(root) {
  try {
    const users = await api('/api/admin/team');
      root.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="lab">👥 用户总数</div><div class="val">${users.length}</div></div>
        <div class="stat-card amber"><div class="lab">🏦 奖励模式</div><div class="val" style="font-size:18px;">直接发放</div><div class="sub">基金池已取消</div></div>
        <div class="stat-card"><div class="lab">👑 V2+ 用户</div><div class="val">${users.filter(u => (u.userLevel||'V1') !== 'V1').length}</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>用户推荐关系与等级</h3></div>
        <div class="panel-body">
          <div class="table-wrap"><table>
            <thead><tr><th>用户</th><th>等级</th><th>直推实名</th><th>个人业绩</th><th>大区业绩</th><th>小区业绩</th><th>团队总业绩</th><th>冻结奖励</th><th>实名</th><th>直推下级</th></tr></thead>
            <tbody>${users.map(u => `<tr>
              <td><b>${esc(u.name)}</b><br><span style="color:#94a3b8;font-size:12px;">${esc(u.uid)}</span></td>
              <td><span class="pill ${(u.userLevel||'V1')==='V1'?'gray':u.userLevel==='V2'?'blue':u.userLevel==='V3'?'indigo':'amber'}">${esc(u.userLevel || 'V1')}</span></td>
              <td>${u.directVerified}</td><td>${Number(u.personalVolume||0).toLocaleString()}</td><td>${Number(u.largeAreaVolume||0).toLocaleString()}</td><td>${Number(u.smallAreaVolume||0).toLocaleString()}</td><td>${Number(u.teamTotalVolume||u.teamVolume||0).toLocaleString()}</td><td>${Number(u.frozenBalance||0).toFixed(2)}</td>
              <td>${statusPill(u.kycStatus)}</td>
              <td style="font-size:12px;">${(u.direct||[]).map(d => esc(d.name)).join('、') || '—'}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">暂无用户</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
      <div class="dash-grid">
        <div class="panel"><div class="panel-head"><h3>📥 直推邀请奖励</h3></div><div class="panel-body" style="max-height:340px;overflow:auto;"><div class="table-wrap"><table><thead><tr><th>推荐人</th><th>被邀请人</th><th>金额</th><th>状态</th></tr></thead><tbody id="inviteTbody"></tbody></table></div></div></div>
        <div class="panel"><div class="panel-head"><h3>👑 等级收益奖励</h3></div><div class="panel-body" style="max-height:340px;overflow:auto;"><div class="table-wrap"><table><thead><tr><th>用户</th><th>等级</th><th>类型</th><th>金额</th><th>来源</th></tr></thead><tbody id="teamTbody"></tbody></table></div></div></div>
      </div>`;
    const inv = await api('/api/admin/invite-rewards');
    $('#inviteTbody').innerHTML = inv.map(i => `<tr><td>${esc(i.referrer_uid)}</td><td>${esc(i.referred_name || i.referred_uid)}</td><td>${Number(i.amount).toFixed(2)}</td><td>${i.status==='frozen'?'<span class="pill amber">冻结</span>':'<span class="pill green">已解冻</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">暂无</td></tr>';
    const tr = await api('/api/admin/team-rewards');
    const rewardType = { direct_profit: '直推提成', lot_bonus: '小区手数奖', differential: '级差奖', same_level: '平级奖' };
    $('#teamTbody').innerHTML = tr.map(t => `<tr><td>${esc(t.name || t.uid || t.member_id)}</td><td>${esc(t.user_level || '')}</td><td>${esc(rewardType[t.reward_type] || t.reward_type)}</td><td>${Number(t.amount).toFixed(4)}</td><td style="font-size:12px;">${esc(t.remark || t.biz_date || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">暂无</td></tr>';
  } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
/* ---------- Settings ---------- */
async function loadSettings(root) {
  root.innerHTML = `
    <div class="panel" style="max-width:520px;">
      <div class="panel-head"><h3>修改管理员密码</h3></div>
      <div class="panel-body">
        <div class="field"><label>原密码</label><input type="password" id="oldPwd"></div>
        <div class="field"><label>新密码</label><input type="password" id="newPwd"></div>
        <div class="field"><label>确认新密码</label><input type="password" id="newPwd2"></div>
        <button class="btn" onclick="changePwd()">修改密码</button>
      </div>
    </div>
    <div class="panel" style="max-width:520px;">
      <div class="panel-head"><h3>系统信息</h3></div>
      <div class="panel-body" style="font-size:13px;color:#475569;line-height:1.9;">
        <div>· 平台名称：盈透copy 智能量化交易与实体众筹投资平台</div>
        <div>· 管理后台路径：/admin</div>
        <div>· 数据存储：SQLite 本地数据库</div>
        <div>· 提示：用户侧前端可通过公开 API（/api/public/*）读取房间、项目、内容与提交充值/提现/实名申请。</div>
      </div>
    </div>`;
}
async function changePwd() {
  const oldPassword = $('#oldPwd').value, newPassword = $('#newPwd').value, c = $('#newPwd2').value;
  if (!oldPassword || !newPassword) return toast('请填写完整', 'error');
  if (newPassword !== c) return toast('两次密码不一致', 'error');
  if (newPassword.length < 6) return toast('密码至少6位', 'error');
  try { await api('/api/auth/password', { method: 'PUT', body: JSON.stringify({ oldPassword, newPassword }) }); toast('密码已修改'); $('#oldPwd').value = $('#newPwd').value = $('#newPwd2').value = ''; } catch (e) { toast(e.message, 'error'); }
}


/* ---------- custom confirm ---------- */
function confirmDialog(message) {
  return new Promise((resolve) => {
    const html = `
      <div class="modal-mask" id="confirmMask">
        <div class="modal" style="max-width:420px;">
          <div class="modal-body" style="padding:24px 22px;">
            <div style="font-size:15px;font-weight:600;margin-bottom:6px;">操作确认</div>
            <div style="color:#475569;line-height:1.7;">${esc(message)}</div>
          </div>
          <div class="modal-foot">
            <button class="btn ghost" id="confirmNo">取消</button>
            <button class="btn" id="confirmYes">确认</button>
          </div>
        </div>
      </div>`;
    const mask = document.createElement('div');
    mask.innerHTML = html;
    document.body.appendChild(mask.firstElementChild);
    $('#confirmYes').onclick = () => { $('#confirmMask').remove(); resolve(true); };
    $('#confirmNo').onclick = () => { $('#confirmMask').remove(); resolve(false); };
    $('#confirmMask').onclick = (e) => { if (e.target === e.currentTarget) { $('#confirmMask').remove(); resolve(false); } };
  });
}
/* ---------- modal helpers ---------- */
function closeModal() { $$('.modal-mask').forEach(m => m.remove()); }

async function loadNotices(root) {
  try {
    const campaigns = await api('/api/admin/notification-campaigns');
    const rows = campaigns.map(function (item) {
      return '<tr><td>' + item.id + '</td><td><b>' + esc(item.title) + '</b></td><td style="max-width:360px;">' + esc(item.body) + '</td><td>' + esc(item.type) + '</td><td>' + (item.is_popup ? '<span class="pill green">弹窗</span>' : '<span class="pill gray">仅通知</span>') + '</td><td>' + esc(item.created_by || '') + '</td><td>' + fmtDate(item.created_at) + '</td></tr>';
    }).join('');
    root.innerHTML = '<div class="panel" style="max-width:760px;"><div class="panel-head"><h3>发布通知</h3><button class="btn sm" onclick="publishNotice()">立即发布</button></div><div class="panel-body"><div class="field"><label>通知标题</label><input id="noticeTitle" placeholder="请输入通知标题"></div><div class="field"><label>通知内容</label><textarea id="noticeBody" rows="5" placeholder="请输入通知内容"></textarea></div><div class="field"><label>通知类型</label><select id="noticeType"><option value="system">系统通知</option><option value="activity">活动通知</option><option value="risk">风险提示</option><option value="maintenance">维护通知</option></select></div><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;"><input id="noticePopup" type="checkbox" checked> 用户当日首次登录时弹窗提醒</label></div></div>' +
      '<div class="panel"><div class="panel-head"><h3>发布记录</h3></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>ID</th><th>标题</th><th>内容</th><th>类型</th><th>方式</th><th>发布人</th><th>发布时间</th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="empty">暂无通知</td></tr>') + '</tbody></table></div></div></div>';
  } catch (e) { root.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
async function publishNotice() {
  const title = $('#noticeTitle').value.trim();
  const body = $('#noticeBody').value.trim();
  if (!title || !body) return toast('请填写通知标题和内容', 'error');
  try {
    const result = await api('/api/admin/notifications/publish', { method: 'POST', body: JSON.stringify({ title, body, type: $('#noticeType').value, isPopup: $('#noticePopup').checked }) });
    toast('通知已发布，接收用户 ' + result.recipients + ' 人');
    loadView();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadSupport(root) {
  try {
    const rows = await api('/api/admin/support-threads');
    const body = rows.map(function (r) {
      return '<tr><td>' + r.id + '</td><td>' + esc(r.name || r.uid) + '<br><small>' + esc(r.uid) + '</small></td><td>' + statusPill(r.status) + '</td><td>' + r.message_count + '</td><td>' + fmtDate(r.updated_at) + '</td><td><button class="btn sm" onclick="openSupport(' + r.id + ')">查看回复</button></td></tr>';
    }).join('');
    root.innerHTML = '<div class="panel"><div class="panel-head"><h3>客服工单</h3></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>ID</th><th>用户</th><th>状态</th><th>消息数</th><th>更新时间</th><th>操作</th></tr></thead><tbody>' + (body || '<tr><td colspan="6" class="empty">暂无工单</td></tr>') + '</tbody></table></div></div></div><div id="supportDetail"></div>';
  } catch (e) { root.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
async function openSupport(id) {
  try {
    const data = await api('/api/admin/support-threads/' + id + '/messages');
    const messages = data.messages.map(function (m) {
      const align = m.sender_type === 'admin' ? 'flex-end' : 'flex-start';
      const color = m.sender_type === 'admin' ? '#dbeafe' : '#f1f5f9';
      return '<div style="align-self:' + align + ';max-width:70%;padding:9px 12px;border-radius:10px;background:' + color + ';font-size:13px;">' + esc(m.content) + '</div>';
    }).join('');
    $('#supportDetail').innerHTML = '<div class="panel"><div class="panel-head"><h3>工单 #' + id + '</h3></div><div class="panel-body"><div style="max-height:320px;overflow:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">' + (messages || '<div class="empty">暂无消息</div>') + '</div><textarea id="supportReply" rows="3" placeholder="输入回复内容" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;"></textarea><button class="btn" style="margin-top:10px" onclick="replySupport(' + id + ')">发送回复</button></div></div>';
  } catch (e) { toast(e.message, 'error'); }
}
async function replySupport(id) {
  const content = $('#supportReply').value.trim();
  if (!content) return toast('请输入回复内容', 'error');
  try { await api('/api/admin/support-threads/' + id + '/reply', { method: 'POST', body: JSON.stringify({ content }) }); toast('回复已发送'); openSupport(id); } catch (e) { toast(e.message, 'error'); }
}
async function loadLeads(root) {
  try {
    const rows = await api('/api/admin/lead-trader-applications');
    const body = rows.map(function (r) {
      const actions = r.status === 'pending' ? '<button class="btn sm" onclick="reviewLead(' + r.id + ',\'approve\')">通过</button> <button class="btn sm ghost" onclick="reviewLead(' + r.id + ',\'reject\')">拒绝</button>' : '已处理';
      return '<tr><td>' + esc(r.name || r.uid) + '<br><small>' + esc(r.uid) + '</small></td><td>' + esc(r.experience) + '</td><td>' + esc(r.strategy) + '</td><td>' + statusPill(r.status) + '</td><td>' + fmtDate(r.created_at) + '</td><td>' + actions + '</td></tr>';
    }).join('');
    root.innerHTML = '<div class="panel"><div class="panel-head"><h3>交易员带单申请</h3></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>用户</th><th>经验</th><th>策略</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead><tbody>' + (body || '<tr><td colspan="6" class="empty">暂无申请</td></tr>') + '</tbody></table></div></div></div>';
  } catch (e) { root.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
async function reviewLead(id, action) {
  try { await api('/api/admin/lead-trader-applications/' + id + '/review', { method: 'POST', body: JSON.stringify({ action }) }); toast(action === 'approve' ? '申请已通过' : '申请已拒绝'); loadView(); } catch (e) { toast(e.message, 'error'); }
}
async function loadAudit(root) {
  try {
    const rows = await api('/api/admin/audit-logs');
    const body = rows.map(function (r) {
      return '<tr><td>' + fmtDate(r.created_at) + '</td><td>' + esc(r.actor_id) + '</td><td>' + esc(r.action) + '</td><td>' + esc(r.target_type) + ' #' + esc(r.target_id) + '</td><td style="font-size:12px;">' + esc(r.detail) + '</td></tr>';
    }).join('');
    root.innerHTML = '<div class="panel"><div class="panel-head"><h3>后台操作审计日志</h3></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>时间</th><th>管理员</th><th>动作</th><th>对象</th><th>详情</th></tr></thead><tbody>' + (body || '<tr><td colspan="5" class="empty">暂无日志</td></tr>') + '</tbody></table></div></div></div>';
  } catch (e) { root.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}

render();