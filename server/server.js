import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const JWT_SECRET = process.env.JWT_SECRET || 'elitetrade-admin-secret-change-me-2026';
const PORT = process.env.PORT || 8787;

initDb();

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ---------- helpers ----------
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function parseTags(s) {
  if (!s) return [];
  try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return String(s).split(',').map(x => x.trim()).filter(Boolean); }
}
function parseArr(s) {
  if (!s) return [];
  try { return typeof s === 'string' ? JSON.parse(s) : (s || []); } catch { return []; }
}

function toProject(pr) {
  return {
    id: pr.id, title: pr.title, subtitle: pr.subtitle, image: pr.image,
    progress: pr.progress, estimatedYield: pr.estimated_yield, targetAmount: pr.target_amount,
    minInvestment: pr.min_investment, exitRoute: pr.exit_route, team: pr.team,
    category: pr.category, raisedAmount: pr.raised_amount, status: pr.status
  };
}
function toRoom(r) {
  return {
    id: r.id, name: r.name, englishName: r.english_name, avatar: r.avatar,
    tags: parseTags(r.tags), totalProfit: r.total_profit, yieldRate: r.yield_rate,
    maxDrawdown: r.max_drawdown, runningDays: r.running_days, followersCount: r.followers_count,
    totalAum: r.total_aum, winRate: r.win_rate, riskLevel: r.risk_level, description: r.description,
    sparkline: parseArr(r.sparkline), monthlyReturn: r.monthly_return, avgDailyReturn: r.avg_daily_return,
    maxProfitSingle: r.max_profit_single, maxLossSingle: r.max_loss_single, avgProfit: r.avg_profit,
    avgLoss: r.avg_loss, lots: r.lots, winTrades: r.win_trades, lossTrades: r.loss_trades,
    assetDistribution: parseArr(r.asset_distribution), category: r.category, isHot: !!r.is_hot,
    dailyYieldMin: r.daily_yield_min, dailyYieldMax: r.daily_yield_max, performanceFee: r.performance_fee, customerShare: r.customer_share, fundShare: r.fund_share,
    status: r.status, sortOrder: r.sort_order, createdAt: r.created_at
  };
}
function toUser(u) {
  return { ...u, kycStatus: u.kyc_status, isVerified: !!u.is_verified, totalAssets: u.total_assets, totalIncome: u.total_income, referrerId: u.referrer_id };
}
const now = () => new Date().toISOString();

// ---------- auth ----------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username || '').trim());
  if (!admin || !bcrypt.compareSync(String(password || ''), admin.password_hash)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, admin: { id: admin.id, username: admin.username, role: admin.role } });
});

app.get('/api/auth/me', auth, (req, res) => {
  const a = db.prepare('SELECT id,username,role FROM admins WHERE id = ?').get(req.admin.id);
  res.json(a);
});

app.put('/api/auth/password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(String(oldPassword || ''), a.password_hash)) return res.status(400).json({ error: '原密码错误' });
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 10), req.admin.id);
  res.json({ ok: true });
});

// ---------- dashboard ----------
app.get('/api/dashboard/stats', auth, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const newUsers7d = db.prepare("SELECT COUNT(*) c FROM users WHERE created_at >= datetime('now','localtime','-7 days')").get().c;
  const activeRooms = db.prepare("SELECT COUNT(*) c FROM rooms WHERE status='active'").get().c;
  const totalDeposits = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='deposit' AND status='approved'").get().s;
  const totalWithdraws = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='withdraw' AND status='approved'").get().s;
  const pendingDeposits = db.prepare("SELECT COUNT(*) c FROM transactions WHERE type='deposit' AND status='pending'").get().c;
  const pendingWithdraws = db.prepare("SELECT COUNT(*) c FROM transactions WHERE type='withdraw' AND status='pending'").get().c;
  const pendingKyc = db.prepare("SELECT COUNT(*) c FROM kyc WHERE status='pending'").get().c;
  const totalCommission = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM commissions').get().s;
  const netFlow = totalDeposits - totalWithdraws;
  res.json({
    totalUsers, newUsers7d, activeRooms, totalDeposits, totalWithdraws, netFlow,
    pendingDeposits, pendingWithdraws, pendingKyc, totalCommission,
    userGrowth: db.prepare("SELECT strftime('%m-%d', created_at) d, COUNT(*) c FROM users GROUP BY d ORDER BY d").all(),
    depositTrend: db.prepare("SELECT strftime('%m-%d', created_at) d, COALESCE(SUM(amount),0) s FROM transactions WHERE type='deposit' AND status='approved' GROUP BY d ORDER BY d").all()
  });
});

// ---------- users ----------
app.get('/api/users', auth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  let sql = 'SELECT * FROM users WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ? OR uid LIKE ?)'; const like = `%${q}%`; params.push(like, like, like, like); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(toUser));
});

app.post('/api/users', auth, (req, res) => {
  const b = req.body || {};
  const uid = b.uid || ('10' + String(Math.floor(Math.random() * 900000) + 100000));
  db.prepare(`INSERT INTO users (uid,name,phone,email,balance,total_assets,available,total_income,referral_code,referrer_id,level,status,kyc_status,is_verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uid, b.name || '', b.phone || '', b.email || '', Number(b.balance)||0, Number(b.balance)||0, (Number(b.available) ?? Number(b.balance)) || 0, Number(b.totalIncome)||0, b.referralCode || ('ET-' + uid.slice(-6)), b.referrerId || null, Number(b.level)||1, b.status || 'active', b.kycStatus || 'unverified', b.isVerified ? 1 : 0);
  res.json({ ok: true });
});

app.put('/api/users/:id', auth, (req, res) => {
  const id = req.params.id;
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '用户不存在' });
  db.prepare(`UPDATE users SET name=?, phone=?, email=?, balance=?, total_assets=?, available=?, total_income=?, status=?, kyc_status=?, is_verified=?, level=? WHERE id=?`)
    .run(b.name ?? cur.name, b.phone ?? cur.phone, b.email ?? cur.email, b.balance ?? cur.balance, b.totalAssets ?? cur.total_assets, b.available ?? cur.available, b.totalIncome ?? cur.total_income, b.status ?? cur.status, b.kycStatus ?? cur.kyc_status, b.isVerified !== undefined ? (b.isVerified ? 1 : 0) : cur.is_verified, b.level ?? cur.level, id);
  res.json({ ok: true });
});

app.delete('/api/users/:id', auth, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- rooms (跟单房间) ----------
app.get('/api/rooms', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM rooms ORDER BY sort_order ASC, id ASC').all();
  res.json(rows.map(toRoom));
});

app.post('/api/rooms', auth, (req, res) => {
  const b = req.body || {};
  const id = b.id || ('room-' + Date.now().toString(36) + Math.floor(Math.random()*1000).toString(36));
  db.prepare(`INSERT INTO rooms (id,name,english_name,avatar,tags,total_profit,yield_rate,max_drawdown,running_days,followers_count,total_aum,win_rate,risk_level,description,sparkline,monthly_return,avg_daily_return,max_profit_single,max_loss_single,avg_profit,avg_loss,lots,win_trades,loss_trades,asset_distribution,category,is_hot,daily_yield_min,daily_yield_max,performance_fee,customer_share,fund_share,status,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.name||'', b.englishName||'', b.avatar||'', JSON.stringify(b.tags||[]), Number(b.totalProfit)||0, Number(b.yieldRate)||0, Number(b.maxDrawdown)||0, Number(b.runningDays)||0, Number(b.followersCount)||0, b.totalAum||'$0', Number(b.winRate)||0, b.riskLevel||'稳健型', b.description||'', JSON.stringify(b.sparkline||[]), Number(b.monthlyReturn)||0, Number(b.avgDailyReturn)||0, Number(b.maxProfitSingle)||0, Number(b.maxLossSingle)||0, Number(b.avgProfit)||0, Number(b.avgLoss)||0, Number(b.lots)||0, Number(b.winTrades)||0, Number(b.lossTrades)||0, JSON.stringify(b.assetDistribution||[]), b.category||'forex', b.isHot?1:0, Number(b.dailyYieldMin)??0.1, Number(b.dailyYieldMax)??0.5, Number(b.performanceFee)??10, Number(b.customerShare)??50, Number(b.fundShare)??40, b.status||'active', Number(b.sortOrder)||0);
  res.json({ ok: true, id });
});

app.put('/api/rooms/:id', auth, (req, res) => {
  const id = req.params.id;
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '房间不存在' });
  db.prepare(`UPDATE rooms SET name=?, english_name=?, avatar=?, tags=?, total_profit=?, yield_rate=?, max_drawdown=?, running_days=?, followers_count=?, total_aum=?, win_rate=?, risk_level=?, description=?, sparkline=?, monthly_return=?, avg_daily_return=?, max_profit_single=?, max_loss_single=?, avg_profit=?, avg_loss=?, lots=?, win_trades=?, loss_trades=?, asset_distribution=?, category=?, is_hot=?, daily_yield_min=?, daily_yield_max=?, performance_fee=?, customer_share=?, fund_share=?, status=?, sort_order=? WHERE id=?`)
    .run(b.name ?? cur.name, b.englishName ?? cur.english_name, b.avatar ?? cur.avatar, b.tags !== undefined ? JSON.stringify(b.tags) : cur.tags, b.totalProfit ?? cur.total_profit, b.yieldRate ?? cur.yield_rate, b.maxDrawdown ?? cur.max_drawdown, b.runningDays ?? cur.running_days, b.followersCount ?? cur.followers_count, b.totalAum ?? cur.total_aum, b.winRate ?? cur.win_rate, b.riskLevel ?? cur.risk_level, b.description ?? cur.description, b.sparkline !== undefined ? JSON.stringify(b.sparkline) : cur.sparkline, b.monthlyReturn ?? cur.monthly_return, b.avgDailyReturn ?? cur.avg_daily_return, b.maxProfitSingle ?? cur.max_profit_single, b.maxLossSingle ?? cur.max_loss_single, b.avgProfit ?? cur.avg_profit, b.avgLoss ?? cur.avg_loss, b.lots ?? cur.lots, b.winTrades ?? cur.win_trades, b.lossTrades ?? cur.loss_trades, b.assetDistribution !== undefined ? JSON.stringify(b.assetDistribution) : cur.asset_distribution, b.category ?? cur.category, b.isHot !== undefined ? (b.isHot ? 1 : 0) : cur.is_hot, b.dailyYieldMin ?? cur.daily_yield_min, b.dailyYieldMax ?? cur.daily_yield_max, b.performanceFee ?? cur.performance_fee, b.customerShare ?? cur.customer_share, b.fundShare ?? cur.fund_share, b.status ?? cur.status, b.sortOrder ?? cur.sort_order, id);
  res.json({ ok: true });
});

app.delete('/api/rooms/:id', auth, (req, res) => {
  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- projects (众筹项目) ----------
app.get('/api/projects', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM projects ORDER BY id ASC').all());
});
app.post('/api/projects', auth, (req, res) => {
  const b = req.body || {};
  const id = b.id || ('proj-' + Date.now().toString(36));
  db.prepare(`INSERT INTO projects (id,title,subtitle,image,progress,estimated_yield,target_amount,min_investment,exit_route,team,category,raised_amount,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.title||'', b.subtitle||'', b.image||'', Number(b.progress)||0, Number(b.estimatedYield)||0, b.targetAmount||'', Number(b.minInvestment)||0, b.exitRoute||'', b.team||'', b.category||'', b.raisedAmount||'', b.status||'active');
  res.json({ ok: true, id });
});
app.put('/api/projects/:id', auth, (req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '项目不存在' });
  db.prepare(`UPDATE projects SET title=?, subtitle=?, image=?, progress=?, estimated_yield=?, target_amount=?, min_investment=?, exit_route=?, team=?, category=?, raised_amount=?, status=? WHERE id=?`)
    .run(b.title ?? cur.title, b.subtitle ?? cur.subtitle, b.image ?? cur.image, b.progress ?? cur.progress, b.estimatedYield ?? cur.estimated_yield, b.targetAmount ?? cur.target_amount, b.minInvestment ?? cur.min_investment, b.exitRoute ?? cur.exit_route, b.team ?? cur.team, b.category ?? cur.category, b.raisedAmount ?? cur.raised_amount, b.status ?? cur.status, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/projects/:id', auth, (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- transactions (充值/提现审核) ----------
app.get('/api/transactions', auth, (req, res) => {
  const status = String(req.query.status || '').trim();
  const type = String(req.query.type || '').trim();
  let sql = 'SELECT * FROM transactions WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.put('/api/transactions/:id/review', auth, (req, res) => {
  const { action, remark } = req.body || {};
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '记录不存在' });
  if (action === 'approve') {
    db.prepare(`UPDATE transactions SET status='approved', reviewed_by=?, reviewed_at=? WHERE id=?`).run(req.admin.username, now(), t.id);
    // credit/debit user balance
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(t.user_id);
    if (user) {
      if (t.type === 'deposit') {
        db.prepare('UPDATE users SET balance = balance + ?, total_assets = total_assets + ?, available = available + ? WHERE id = ?').run(t.amount, t.amount, t.amount, user.id);
      } else if (t.type === 'withdraw') {
        db.prepare('UPDATE users SET balance = balance - ?, total_assets = total_assets - ?, available = available - ? WHERE id = ?').run(t.amount, t.amount, t.amount, user.id);
      }
    }
  } else if (action === 'reject') {
    db.prepare(`UPDATE transactions SET status='rejected', reviewed_by=?, reviewed_at=? WHERE id=?`).run(req.admin.username, now(), t.id);
  } else {
    return res.status(400).json({ error: '无效操作' });
  }
  res.json({ ok: true });
});

// ---------- kyc (实名审核) ----------
app.get('/api/kyc', auth, (req, res) => {
  const status = String(req.query.status || '').trim();
  let sql = 'SELECT * FROM kyc';
  const params = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.put('/api/kyc/:id/review', auth, (req, res) => {
  const { action } = req.body || {};
  const k = db.prepare('SELECT * FROM kyc WHERE id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: '记录不存在' });
  const newStatus = action === 'approve' ? 'verified' : 'rejected';
  db.prepare(`UPDATE kyc SET status=?, reviewed_by=?, reviewed_at=? WHERE id=?`).run(newStatus, req.admin.username, now(), k.id);
  db.prepare(`UPDATE users SET kyc_status=?, is_verified=? WHERE id=?`).run(newStatus === 'verified' ? 'verified' : 'rejected', newStatus === 'verified' ? 1 : 0, k.user_id);
  res.json({ ok: true });
});

// ---------- commissions (推广收益) ----------
app.get('/api/commissions', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM commissions ORDER BY id DESC').all();
  const rates = db.prepare('SELECT level, rate FROM commission_rates ORDER BY level').all();
  res.json({ list: rows, rates });
});
app.put('/api/commissions/rates', auth, (req, res) => {
  const { rates } = req.body || {};
  if (!Array.isArray(rates)) return res.status(400).json({ error: '参数错误' });
  const st = db.prepare('INSERT OR REPLACE INTO commission_rates (level, rate) VALUES (?,?)');
  rates.forEach(r => st.run(Number(r.level), Number(r.rate)));
  res.json({ ok: true });
});

// ---------- content (前端页面内容) ----------
app.get('/api/content', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM content_settings ORDER BY key').all());
});
app.put('/api/content', auth, (req, res) => {
  const items = req.body?.items || [];
  const st = db.prepare(`INSERT OR REPLACE INTO content_settings (key,value,type,updated_by,updated_at) VALUES (?,?,?,?,datetime('now','localtime'))`);
  items.forEach(i => st.run(String(i.key), String(i.value ?? ''), i.type || 'text', req.admin.username));
  res.json({ ok: true });
});

// ---------- public API for frontend ----------
app.get('/api/public/content', (req, res) => {
  const rows = db.prepare('SELECT key, value, type FROM content_settings').all();
  const out = {};
  rows.forEach(r => out[r.key] = r.value);
  res.json(out);
});
app.get('/api/public/rooms', (req, res) => {
  const rows = db.prepare("SELECT * FROM rooms WHERE status='active' ORDER BY sort_order ASC").all();
  res.json(rows.map(toRoom));
});
app.get('/api/public/projects', (req, res) => {
  res.json(db.prepare("SELECT * FROM projects WHERE status='active' ORDER BY id ASC").all().map(toProject));
});
app.post('/api/public/register', (req, res) => {
  const b = req.body || {};
  if (!b.phone && !b.email) return res.status(400).json({ error: '请填写手机号或邮箱' });
  const uid = '10' + String(Math.floor(Math.random() * 900000) + 100000);
  const ref = 'ET-' + uid.slice(-6);
  let referrerId = null;
  if (b.referralCode) {
    const refUser = db.prepare('SELECT * FROM users WHERE referral_code = ?').get(String(b.referralCode).trim());
    if (refUser) referrerId = refUser.id;
  }
  db.prepare(`INSERT INTO users (uid,name,phone,email,password,balance,referral_code,referrer_id,level,status,kyc_status) VALUES (?,?,?,?,?,0,?,?,1,'active','unverified')`)
    .run(uid, b.name || '', b.phone || '', b.email || '', b.password || '', ref, referrerId);
  res.json({ ok: true, uid });
});
app.post('/api/public/deposit', (req, res) => {
  const b = req.body || {};
  const txn = 'TXN-' + Date.now() + Math.floor(Math.random()*1000);
  const user = b.uid ? db.prepare('SELECT * FROM users WHERE uid = ?').get(String(b.uid)) : null;
  const userId = user ? user.id : (b.userId || 0);
  const userName = user ? user.name : (b.userName || '');
  db.prepare(`INSERT INTO transactions (txn_id,user_id,user_name,type,amount,network,address,title,subtitle,status,date,time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(txn, userId, userName, 'deposit', Number(b.amount)||0, b.network || 'USDT-TRC20', b.address || '', 'USDT Deposit', '充值待确认', 'pending', new Date().toISOString().slice(0,10), new Date().toTimeString().slice(0,5));
  res.json({ ok: true, txn });
});
app.post('/api/public/withdraw', (req, res) => {
  const b = req.body || {};
  const txn = 'TXN-' + Date.now() + Math.floor(Math.random()*1000);
  const user = b.uid ? db.prepare('SELECT * FROM users WHERE uid = ?').get(String(b.uid)) : null;
  const amount = Number(b.amount) || 0;
  // 45天提现规则：跟单45天内仅可提现累计本金
  if (user) {
    const earliestFollow = db.prepare("SELECT MIN(created_at) m FROM follows WHERE uid = ? AND status='active'").get(user.uid);
    if (earliestFollow && earliestFollow.m) {
      const ageDays = (Date.now() - new Date(earliestFollow.m).getTime()) / 86400000;
      if (ageDays < 45) {
        const totalPrincipal = db.prepare("SELECT COALESCE(SUM(allocated),0) s FROM follows WHERE uid=? AND status='active'").get(user.uid).s;
        const totalWithdrawn = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE user_id=? AND type='withdraw' AND status='approved'").get(user.id).s;
        if (totalWithdrawn + amount > totalPrincipal) {
          return res.status(400).json({ error: '按跟单协议：45天内仅可提现累计本金，收益将于45天后开放提现' });
        }
      }
    }
  }
  const userId = user ? user.id : (b.userId || 0);
  const userName = user ? user.name : (b.userName || '');
  db.prepare(`INSERT INTO transactions (txn_id,user_id,user_name,type,amount,network,address,title,subtitle,status,date,time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(txn, userId, userName, 'withdraw', amount, b.network || 'USDT-TRC20', b.address || '', 'USDT Withdraw', '提现待审核', 'pending', new Date().toISOString().slice(0,10), new Date().toTimeString().slice(0,5));
  res.json({ ok: true, txn });
});
app.post('/api/public/kyc', (req, res) => {
  const b = req.body || {};
  const user = b.uid ? db.prepare('SELECT * FROM users WHERE uid = ?').get(String(b.uid)) : null;
  const userId = user ? user.id : (b.userId || 0);
  const userName = user ? user.name : (b.userName || '');
  db.prepare(`INSERT INTO kyc (user_id,user_name,kyc_type,id_number,real_name,front_image,back_image,handheld_image,status) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(userId, userName, b.kycType || '身份证', b.idNumber || '', b.realName || '', b.frontImage || '', b.backImage || '', b.handheldImage || '', 'pending');
  res.json({ ok: true });
});


// ---------- public API: user session / follow / transactions ----------
app.post('/api/public/login', (req, res) => {
  const b = req.body || {};
  const key = String(b.account || '').trim();
  const pwd = String(b.password || '');
  if (!key) return res.status(400).json({ error: '请输入账号' });
  const user = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ? OR uid = ?').get(key, key, key);
  if (!user) return res.status(404).json({ error: '账号不存在' });
  if (user.password && user.password !== pwd) return res.status(401).json({ error: '密码错误' });
  if (user.status === 'frozen') return res.status(403).json({ error: '账号已被冻结' });
  res.json({ ok: true, user: toUser(user) });
});

app.get('/api/public/user', (req, res) => {
  const uid = String(req.query.uid || '');
  const id = Number(req.query.id || 0);
  let user = null;
  if (uid) user = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid);
  else if (id) user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ ok: true, user: toUser(user) });
});

app.get('/api/public/transactions', (req, res) => {
  const uid = String(req.query.uid || '');
  const id = Number(req.query.id || 0);
  const user = uid ? db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) : db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.json([]);
  const rows = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC').all(user.id);
  res.json(rows.map(t => ({ id: t.id, txnId: t.txn_id, type: t.type, amount: t.amount, network: t.network, title: t.title, subtitle: t.subtitle, status: t.status, createdAt: t.created_at })));
});

app.post('/api/public/follow', (req, res) => {
  const b = req.body || {};
  const uid = String(b.uid || '');
  const user = uid ? db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) : null;
  if (!user) return res.status(404).json({ error: '请先登录' });
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(String(b.roomId || ''));
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const allocated = Number(b.amount) || 0;
  if (allocated > (user.available || 0)) return res.status(400).json({ error: '可用资金不足' });
  db.prepare('UPDATE users SET available = available - ?, total_assets = total_assets - ? WHERE id = ?').run(allocated, allocated, user.id);
  db.prepare('UPDATE rooms SET followers_count = followers_count + 1 WHERE id = ?').run(room.id);
  const st = db.prepare('INSERT INTO follows (uid, user_id, room_id, room_name, avatar, allocated, status, created_at) VALUES (?,?,?,?,?,?,?,?)');
  st.run(uid, user.id, room.id, room.name, room.avatar, allocated, 'active', new Date().toISOString());
  res.json({ ok: true });
});

app.get('/api/public/follows', (req, res) => {
  const uid = String(req.query.uid || '');
  if (!uid) return res.json([]);
  const rows = db.prepare('SELECT * FROM follows WHERE uid = ? ORDER BY id DESC').all(uid);
  res.json(rows.map(f => ({ id: f.id, roomId: f.room_id, roomName: f.room_name, avatar: f.avatar, allocated: f.allocated, status: f.status, createdAt: f.created_at, currentPnL: Math.round((f.allocated || 0) * 0.124) })));
});

app.put('/api/public/follows/:id/pause', (req, res) => {
  const f = db.prepare('SELECT * FROM follows WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: '记录不存在' });
  const next = f.status === 'paused' ? 'active' : 'paused';
  db.prepare('UPDATE follows SET status = ? WHERE id = ?').run(next, f.id);
  res.json({ ok: true, status: next });
});


// ---------- public API: quotes / referral / profile / overview / invest ----------
app.get('/api/public/quotes', (req, res) => {
  res.json(db.prepare('SELECT symbol, name, price, ask_price as askPrice, change_percent as change, category FROM quotes ORDER BY category, symbol').all());
});

app.get('/api/public/referral', (req, res) => {
  const uid = String(req.query.uid || '');
  const user = uid ? db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) : null;
  if (!user) return res.status(404).json({ error: '请先登录' });
  const rates = db.prepare('SELECT level, rate FROM commission_rates ORDER BY level').all();
  const team = db.prepare('SELECT COUNT(*) c FROM users WHERE referrer_id = ?').get(user.id).c;
  const commissions = db.prepare('SELECT * FROM commissions WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(user.id);
  const totalCommission = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE user_id = ?').get(user.id).s;
  res.json({
    code: user.referral_code,
    teamSize: team,
    totalCommission,
    rates: rates.map(r => ({ level: r.level, rate: r.rate })),
    commissions: commissions.map(c2 => ({ id: c2.id, level: c2.level, amount: c2.amount, rate: c2.rate, orderId: c2.order_id, createdAt: c2.created_at }))
  });
});

app.put('/api/public/user/update', (req, res) => {
  const b = req.body || {};
  const uid = String(b.uid || '');
  const user = uid ? db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) : null;
  if (!user) return res.status(404).json({ error: '请先登录' });
  db.prepare('UPDATE users SET name=?, email=?, phone=?, avatar=? WHERE id=?')
    .run(b.name ?? user.name, b.email ?? user.email, b.phone ?? user.phone, (b.avatar ?? user.avatar) || '', user.id);
  res.json({ ok: true, user: toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

app.get('/api/public/overview', (req, res) => {
  const uid = String(req.query.uid || '');
  const user = uid ? db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) : null;
  if (!user) return res.status(404).json({ error: '请先登录' });
  const follows = db.prepare('SELECT * FROM follows WHERE uid = ?').all(uid);
  const investments = db.prepare('SELECT * FROM investments WHERE uid = ?').all(uid);
  const txns = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id);
  const myCopyAlloc = follows.reduce((s, f) => s + (f.allocated || 0), 0);
  const myCopyPnl = follows.reduce((s, f) => s + Math.round((f.allocated || 0) * 0.124), 0);
  const myInvest = investments.reduce((s, i) => s + (i.amount || 0), 0);
  const commission = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE user_id = ?').get(user.id).s;
  res.json({
    user: toUser(user),
    stats: {
      totalAssets: user.total_assets,
      balance: user.balance,
      available: user.available,
      totalIncome: user.total_income,
      myCopyAlloc,
      myCopyPnl,
      myInvest,
      commission,
      followCount: follows.length,
      investCount: investments.length,
      todayProfit: 0
    },
    follows: follows.map(f => ({ id: f.id, roomId: f.room_id, roomName: f.room_name, avatar: f.avatar, allocated: f.allocated, status: f.status, createdAt: f.created_at, currentPnL: Math.round((f.allocated || 0) * 0.124) })),
    investments: investments.map(i => ({ id: i.id, projectId: i.project_id, projectTitle: i.project_title, amount: i.amount, status: i.status, createdAt: i.created_at })),
    transactions: txns.map(t => ({ id: t.id, txnId: t.txn_id, type: t.type, amount: t.amount, network: t.network, title: t.title, subtitle: t.subtitle, status: t.status, createdAt: t.created_at }))
  });
});

app.post('/api/public/invest', (req, res) => {
  const b = req.body || {};
  const uid = String(b.uid || '');
  const user = uid ? db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) : null;
  if (!user) return res.status(404).json({ error: '请先登录' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(String(b.projectId || ''));
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const amount = Number(b.amount) || 0;
  if (amount <= 0) return res.status(400).json({ error: '金额无效' });
  db.prepare('INSERT INTO investments (uid, user_id, project_id, project_title, amount) VALUES (?,?,?,?,?)')
    .run(uid, user.id, project.id, project.title, amount);
  // 自动建群/入群：项目融资进度达到 100% 时自动生成股东群
  const invested = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM investments WHERE project_id = ?').get(project.id).s;
  const target = parseFloat(String(project.target_amount || '0').replace(/[^0-9.]/g, '')) || 0;
  const progress = target > 0 ? Math.min(100, Math.round(invested / target * 1000) / 10) : project.progress;
  db.prepare('UPDATE projects SET progress = ? WHERE id = ?').run(progress, project.id);
  if (progress >= 100) {
    const grp = ensureProjectGroup(project.id);
    if (grp) db.prepare('INSERT OR IGNORE INTO group_members (group_id,uid,user_name) VALUES (?,?,?)').run(grp.id, uid, user.name);
  }
  res.json({ ok: true, groupCreated: progress >= 100 });
});


// ================= 日化收益结算引擎 =================
function randBetween(min, max) { return Number((min + Math.random() * (max - min)).toFixed(4)); }

function settleDaily(req) {
  const today = new Date().toISOString().slice(0, 10);
  const done = db.prepare('SELECT COUNT(*) c FROM yield_records WHERE settle_date = ?').get(today).c;
  if (done > 0 && !req?.query?.force) return { skipped: true, count: 0, reason: '今天已结算' };
  const follows = db.prepare("SELECT * FROM follows WHERE status = 'active'").all();
  let count = 0;
  for (const f of follows) {
    const already = db.prepare('SELECT COUNT(*) c FROM yield_records WHERE follow_id = ? AND settle_date = ?').get(f.id, today).c;
    if (already > 0) continue;
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(f.room_id);
    if (!room || room.daily_yield_min == null) continue;
    const principal = f.allocated || 0;
    if (principal <= 0) continue;
    const minY = Number(room.daily_yield_min || 0.1);
    const maxY = Number(room.daily_yield_max || 0.5);
    const yieldRate = randBetween(minY, maxY);
    const profit = Number((principal * yieldRate / 100).toFixed(4));
    if (profit <= 0) continue;
    const feePct = Number(room.performance_fee || 10);
    const custPct = Number(room.customer_share || 50);
    const traderShare = Number((profit * feePct / 100).toFixed(4));
    const customerShare = Number((profit * custPct / 100).toFixed(4));
    const fundShare = Number((profit - traderShare - customerShare).toFixed(4));
    // credit customer
    const user = db.prepare('SELECT * FROM users WHERE uid = ?').get(f.uid);
    if (user) {
      db.prepare('UPDATE users SET balance = balance + ?, available = available + ?, total_income = total_income + ? WHERE id = ?').run(customerShare, customerShare, customerShare, user.id);
    }
    // record trader earnings on room
    db.prepare('UPDATE rooms SET total_profit = total_profit + ?, leader_earnings = COALESCE(leader_earnings,0) + ? WHERE id = ?').run(profit, traderShare, room.id);
    // insert yield record
    db.prepare('INSERT INTO yield_records (follow_id,uid,room_id,room_name,principal,yield_rate,profit,trader_share,customer_share,fund_share,settle_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(f.id, f.uid, room.id, room.name, principal, yieldRate, profit, traderShare, customerShare, fundShare, today);
    // fund pool -> referral rewards (3 levels)
    allocateReferralRewards(user, fundShare, room.name, today);
    count++;
  }
  return { skipped: false, count };
}

function allocateReferralRewards(user, fundShare, source, date) {
  if (!user || fundShare <= 0) return;
  const levels = [
    { level: 1, pct: 0.50 },
    { level: 2, pct: 0.30 },
    { level: 3, pct: 0.20 },
  ];
  let prevId = user.referrer_id;
  let unallocated = fundShare;
  for (const lv of levels) {
    if (!prevId) break;
    const ref = db.prepare('SELECT * FROM users WHERE id = ?').get(prevId);
    if (!ref) break;
    const amt = Number((fundShare * lv.pct).toFixed(4));
    if (amt > 0) {
      db.prepare('UPDATE users SET balance = balance + ?, available = available + ?, total_income = total_income + ? WHERE id = ?').run(amt, amt, amt, ref.id);
      db.prepare('INSERT INTO referral_rewards (from_uid,from_name,to_uid,to_name,level,amount,source) VALUES (?,?,?,?,?,?,?)')
        .run(user.uid, user.name, ref.uid, ref.name, lv.level, amt, source + ' ' + date);
      unallocated = Number((unallocated - amt).toFixed(4));
    }
    prevId = ref.referrer_id;
  }
  if (unallocated > 0) {
    db.prepare('INSERT INTO fund_pool (amount, note) VALUES (?,?)').run(unallocated, '平台留存 ' + source + ' ' + date);
  }
}

// 定时结算：每天 06:00-06:10 自动执行一次
setInterval(() => {
  const d = new Date();
  if (d.getHours() === 6 && d.getMinutes() < 10) {
    try { settleDaily(); } catch (e) { console.error('settle error', e.message); }
  }
}, 60000);

app.post('/api/admin/settle', auth, (req, res) => {
  const r = settleDaily(req);
  res.json(r);
});

app.get('/api/admin/yields', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM yield_records ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
});

// ================= 用户收益与推荐奖励 =================
app.get('/api/public/yields', (req, res) => {
  const uid = String(req.query.uid || '');
  if (!uid) return res.json([]);
  res.json(db.prepare('SELECT * FROM yield_records WHERE uid = ? ORDER BY id DESC').all(uid));
});

app.get('/api/public/rewards', (req, res) => {
  const uid = String(req.query.uid || '');
  if (!uid) return res.json([]);
  res.json(db.prepare('SELECT * FROM referral_rewards WHERE to_uid = ? ORDER BY id DESC').all(uid));
});

// ================= 众筹群聊 =================
function ensureProjectGroup(projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  let grp = db.prepare('SELECT * FROM groups WHERE project_id = ?').get(projectId);
  if (!grp) {
    const code = 'G' + Date.now().toString(36).toUpperCase().slice(-6);
    const info = db.prepare('INSERT INTO groups (project_id,project_title,name,invite_code) VALUES (?,?,?,?)').run(projectId, project.title, project.title + ' 股东群', code);
    grp = db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid);
    // add all existing investors
    const investors = db.prepare('SELECT DISTINCT uid, user_id FROM investments WHERE project_id = ?').all(projectId);
    for (const inv of investors) {
      const u = db.prepare('SELECT * FROM users WHERE uid = ?').get(inv.uid);
      if (u) db.prepare('INSERT OR IGNORE INTO group_members (group_id,uid,user_name) VALUES (?,?,?)').run(grp.id, u.uid, u.name);
    }
  }
  return grp;
}

app.get('/api/public/groups', (req, res) => {
  const uid = String(req.query.uid || '');
  if (!uid) return res.json([]);
  const rows = db.prepare('SELECT g.* FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.uid = ? ORDER BY g.id DESC').all(uid);
  res.json(rows);
});

app.get('/api/public/groups/:id/messages', (req, res) => {
  res.json(db.prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY id ASC LIMIT 200').all(req.params.id));
});

app.post('/api/public/groups/:id/message', (req, res) => {
  const b = req.body || {};
  const uid = String(b.uid || '');
  const user = uid ? db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) : null;
  const member = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND uid = ?').get(req.params.id, uid);
  if (!member) return res.status(403).json({ error: '您不是该群成员' });
  const content = String(b.content || '').slice(0, 500);
  if (!content) return res.status(400).json({ error: '消息不能为空' });
  db.prepare('INSERT INTO group_messages (group_id,uid,user_name,content) VALUES (?,?,?,?)').run(req.params.id, uid, user ? user.name : uid, content);
  res.json({ ok: true });
});

// 投资：达到100%自动建群 + 加入群
const originalInvest = app.post.bind(app);
// ---------- static ----------
const ADMIN_DIST = path.join(ROOT, 'admin-dist');
const FRONT_DIST = path.join(ROOT, 'frontend-dist');

app.use('/admin', express.static(ADMIN_DIST));
app.use('/admin', (req, res) => res.sendFile(path.join(ADMIN_DIST, 'index.html')));
app.use(express.static(FRONT_DIST));
app.use((req, res) => res.sendFile(path.join(FRONT_DIST, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`EliteTrade Admin Server running on http://localhost:${PORT}`);
  console.log(`- Admin UI: http://localhost:${PORT}/admin`);
  console.log(`- Frontend: http://localhost:${PORT}/`);
  console.log(`- API: http://localhost:${PORT}/api/...`);
});