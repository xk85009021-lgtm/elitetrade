/* EliteTrade Admin Console */
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
        <div class="login-logo"><div class="logo-box">ET</div><div><div class="login-title">EliteTrade 管理后台</div></div></div>
        <div class="login-sub">智能量化交易与实体众筹投资平台 · 运营管理控制台</div>
        <form id="loginForm">
          <div class="field"><label>管理员账号</label><input name="username" placeholder="请输入账号" autocomplete="username" value="admin"></div>
          <div class="field"><label>密码</label><input name="password" type="password" placeholder="请输入密码" autocomplete="current-password"></div>
          <button class="btn full" type="submit">登 录</button>
        </form>
        <div style="margin-top:16px;font-size:12px;color:#94a3b8;text-align:center;">默认账号 admin / Admin@123456（登录后请及时修改密码）</div>
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
  ['content', '🖼️', '内容管理'],
  ['settings', '⚙️', '系统设置'],
];
const NAV_TITLES = Object.fromEntries(NAV.map(n => [n[0], n[2]]));

function renderLayout() {
  const badges = {};
  ['transactions', 'kyc'].forEach(k => { badges[k] = state.data[k + '_badge'] || ''; });
  $('#app').innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="side-head"><div class="logo-box">ET</div><div><div class="t1">EliteTrade</div><div class="t2">管理后台</div></div></div>
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
  const fn = { dashboard: loadDashboard, users: loadUsers, rooms: loadRooms, projects: loadProjects, transactions: loadTransactions, settle: loadSettle, kyc: loadKyc, commissions: loadCommissions, content: loadContent, settings: loadSettings }[state.view];
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
            <thead><tr><th>UID</th><th>姓名</th><th>联系方式</th><th>资产(USD)</th><th>累计收益</th><th>邀请码</th><th>状态</th><th>实名</th><th>注册时间</th><th>操作</th></tr></thead>
            <tbody>${users.map(u => `<tr>
              <td>${esc(u.uid)}</td><td><b>${esc(u.name)}</b></td><td>${esc(u.phone)}<br><span style="color:#94a3b8;font-size:12px;">${esc(u.email)}</span></td>
              <td>$${fmtMoney(u.balance)}</td><td>$${fmtMoney(u.total_income)}</td><td>${esc(u.referral_code)}</td>
              <td>${statusPill(u.status)}</td><td>${statusPill(u.kyc_status)}</td><td>${fmtDate(u.created_at)}</td>
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
        <div class="field"><label>推广等级</label><select name="level"><option value="1" ${u.level==1?'selected':''}>一级</option><option value="2" ${u.level==2?'selected':''}>二级</option><option value="3" ${u.level==3?'selected':''}>三级</option></select></div>
        <div class="field"><label>状态</label><select name="status"><option value="active" ${u.status==='active'?'selected':''}>正常</option><option value="frozen" ${u.status==='frozen'?'selected':''}>冻结</option></select></div>
        <div class="field"><label>实名状态</label><select name="kycStatus"><option value="unverified" ${u.kyc_status==='unverified'?'selected':''}>未认证</option><option value="pending" ${u.kyc_status==='pending'?'selected':''}>待审核</option><option value="verified" ${u.kyc_status==='verified'?'selected':''}>已认证</option><option value="rejected" ${u.kyc_status==='rejected'?'selected':''}>已拒绝</option></select></div>
        <div class="field full"><label>邀请码</label><input name="referralCode" value="${esc(u.referral_code)}"></div>
      </form></div>
      <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" onclick="saveUser(${id || 0})">保存</button></div>
    </div></div>`;
  const mask = document.createElement('div'); mask.innerHTML = html; document.body.appendChild(mask.firstElementChild);
}
async function saveUser(id) {
  const f = new FormData($('#userForm'));
  const body = {
    name: f.get('name'), phone: f.get('phone'), email: f.get('email'),
    balance: Number(f.get('balance')), available: Number(f.get('available')), totalIncome: Number(f.get('totalIncome')),
    level: Number(f.get('level')), status: f.get('status'), kycStatus: f.get('kycStatus'), referralCode: f.get('referralCode')
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
        <div class="field"><label>头像URL</label><input name="avatar" value="${esc(r.avatar)}"></div>
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
        <div class="field"><label>客户分成 %</label><input name="customerShare" type="number" step="0.1" value="${r.customerShare ?? 50}"></div>
        <div class="field"><label>基金池 %（推荐奖励）</label><input name="fundShare" type="number" step="0.1" value="${r.fundShare ?? 40}"></div>
        <div class="field full" style="font-size:12px;color:#64748b;background:#f1f5f9;padding:8px 12px;border-radius:8px;">💡 日化收益率：系统每天 06:00 在该区间内随机为每位跟单客户结算收益（本金×收益率），收益按「绩效费/客户/基金池」比例自动分配。</div>
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
    category: f.get('category'), sortOrder: Number(f.get('sortOrder')), isHot: f.get('isHot') === '1', dailyYieldMin: Number(f.get('dailyYieldMin')), dailyYieldMax: Number(f.get('dailyYieldMax')), performanceFee: Number(f.get('performanceFee')), customerShare: Number(f.get('customerShare')), fundShare: Number(f.get('fundShare')),
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
            <thead><tr><th>订单号</th><th>用户</th><th>类型</th><th>金额(USD)</th><th>网络</th><th>地址</th><th>时间</th><th>状态</th><th>审核人</th><th>操作</th></tr></thead>
            <tbody>${list.map(t => `<tr>
              <td>${esc(t.txn_id)}</td><td><b>${esc(t.user_name)}</b></td>
              <td>${t.type === 'deposit' ? '<span class="pill green">充值</span>' : '<span class="pill amber">提现</span>'}</td>
              <td><b>$${fmtMoney(t.amount)}</b></td><td>${esc(t.network)}</td><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(t.address)}">${esc(t.address) || '—'}</td>
              <td>${fmtDate(t.created_at)}</td><td>${statusPill(t.status)}</td><td>${esc(t.reviewed_by || '—')}</td>
              <td>${t.status === 'pending' ? `<div class="row-actions"><button class="btn xs green" onclick="reviewTxn(${t.id},'approve')">通过</button><button class="btn xs danger" onclick="reviewTxn(${t.id},'reject')">拒绝</button></div>` : '—'}</td>
            </tr>`).join('') || '<tr><td colspan="10" class="empty">暂无记录</td></tr>'}</tbody>
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

/* ---------- Commissions ---------- */
async function loadCommissions(root) {
  try {
    const { list, rates } = await api('/api/commissions');
    const total = list.reduce((s, c) => s + Number(c.amount || 0), 0);
    root.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card green"><div class="lab">💰 累计发放佣金</div><div class="val">$${fmtMoney(total)}</div><div class="sub">共 ${list.length} 笔</div></div>
        <div class="stat-card"><div class="lab">🔗 一级返佣</div><div class="val">${(rates.find(r => r.level === 1) || {}).rate ?? 20}%</div></div>
        <div class="stat-card"><div class="lab">🔗 二级返佣</div><div class="val">${(rates.find(r => r.level === 2) || {}).rate ?? 12}%</div></div>
        <div class="stat-card"><div class="lab">🔗 三级返佣</div><div class="val">${(rates.find(r => r.level === 3) || {}).rate ?? 8}%</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>返佣比例设置</h3></div>
        <div class="panel-body">
          <div class="toolbar">
            <div class="field" style="margin:0;"><label>一级 %</label><input type="number" id="rate1" value="${(rates.find(r=>r.level===1)||{}).rate ?? 20}" style="width:90px;"></div>
            <div class="field" style="margin:0;"><label>二级 %</label><input type="number" id="rate2" value="${(rates.find(r=>r.level===2)||{}).rate ?? 12}" style="width:90px;"></div>
            <div class="field" style="margin:0;"><label>三级 %</label><input type="number" id="rate3" value="${(rates.find(r=>r.level===3)||{}).rate ?? 8}" style="width:90px;"></div>
            <button class="btn sm" onclick="saveRates()">保存比例</button>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>佣金明细</h3></div>
        <div class="panel-body">
          <div class="table-wrap"><table>
            <thead><tr><th>ID</th><th>用户</th><th>级别</th><th>金额(USD)</th><th>比例</th><th>订单</th><th>时间</th></tr></thead>
            <tbody>${list.map(c => `<tr><td>${c.id}</td><td><b>${esc(c.user_name)}</b></td><td>${c.level}级</td><td>$${fmtMoney(c.amount)}</td><td>${(c.rate * 100).toFixed(0)}%</td><td>${esc(c.order_id)}</td><td>${fmtDate(c.created_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">暂无记录</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
  } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function saveRates() {
  const rates = [1, 2, 3].map(l => ({ level: l, rate: Number($('#rate' + l).value) }));
  try { await api('/api/commissions/rates', { method: 'PUT', body: JSON.stringify({ rates }) }); toast('返佣比例已更新'); loadView(); } catch (e) { toast(e.message, 'error'); }
}/* ---------- Content ---------- */
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
        <div class="stat-card"><div class="lab">🟦 基金池分成</div><div class="val">${totalFund.toFixed(2)}</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>日化收益结算</h3><button class="btn sm" onclick="manualSettle()">⚡ 立即结算</button></div>
        <div class="panel-body" style="font-size:13px;color:#475569;line-height:1.8;">
          <div>· 系统每天 <b>06:00</b> 自动为所有运行中的跟单按房间「日化收益率区间」随机结算一次收益；</div>
          <div>· 分配比例：绩效费（交易员）/ 客户 / 基金池（推荐奖励），由房间设置决定；</div>
          <div>· 点击「立即结算」可手动触发（幂等：同一跟单每天仅结算一次）。</div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>收益流水</h3></div>
        <div class="panel-body">
          <div class="table-wrap"><table>
            <thead><tr><th>ID</th><th>用户</th><th>房间</th><th>本金</th><th>日化收益率</th><th>收益</th><th>交易员</th><th>客户</th><th>基金池</th><th>结算日</th></tr></thead>
            <tbody>${yields.map(y => `<tr>
              <td>${y.id}</td><td>${esc(y.uid)}</td><td>${esc(y.room_name)}</td>
              <td>${y.principal}</td><td>${y.yield_rate}%</td><td><b>${Number(y.profit).toFixed(4)}</b></td>
              <td>${Number(y.trader_share).toFixed(4)}</td><td style="color:var(--green)">${Number(y.customer_share).toFixed(4)}</td><td>${Number(y.fund_share).toFixed(4)}</td>
              <td>${esc(y.settle_date)}</td>
            </tr>`).join('') || '<tr><td colspan="10" class="empty">暂无结算记录，点击「立即结算」试试</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
  } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function manualSettle() {
  try { await api('/api/admin/settle?force=1', { method: 'POST' }); toast('结算完成'); loadView(); } catch (e) { toast(e.message, 'error'); }
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
        <div>· 平台名称：EliteTrade 智能量化交易与实体众筹投资平台</div>
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

render();