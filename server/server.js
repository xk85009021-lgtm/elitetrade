import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, initDb } from './db.js';
import QRCode from 'qrcode';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}
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
  db.prepare(`INSERT INTO users (uid,name,phone,email,password,balance,total_assets,available,total_income,frozen_balance,user_level,referral_code,referrer_id,level,status,kyc_status,is_verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uid, b.name || '', b.phone || '', b.email || '', String(b.password || ''), Number(b.balance)||0, Number(b.balance)||0, (Number(b.available) ?? Number(b.balance)) || 0, Number(b.totalIncome)||0, Number(b.frozenBalance)||0, b.userLevel || 'L0', b.referralCode || ('ET-' + uid.slice(-6)), b.referrerId || null, b.userLevel === 'L0' ? 0 : Number(b.level)||1, b.status || 'active', b.kycStatus || 'unverified', b.isVerified ? 1 : 0);
  res.json({ ok: true });
});

app.put('/api/users/:id', auth, (req, res) => {
  const id = req.params.id;
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '用户不存在' });
  db.prepare(`UPDATE users SET name=?, phone=?, email=?, password=?, balance=?, total_assets=?, available=?, total_income=?, frozen_balance=?, user_level=?, status=?, kyc_status=?, is_verified=?, level=? WHERE id=?`)
    .run(b.name ?? cur.name, b.phone ?? cur.phone, b.email ?? cur.email, b.password !== undefined ? String(b.password) : cur.password, b.balance ?? cur.balance, b.totalAssets ?? cur.total_assets, b.available ?? cur.available, b.totalIncome ?? cur.total_income, b.frozenBalance ?? cur.frozen_balance, b.userLevel ?? cur.user_level, b.status ?? cur.status, b.kycStatus ?? cur.kyc_status, b.isVerified !== undefined ? (b.isVerified ? 1 : 0) : cur.is_verified, b.userLevel ? (b.userLevel === 'L0' ? 0 : b.userLevel === 'L1' ? 1 : b.userLevel === 'L2' ? 2 : 3) : cur.level, id);
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
  let inviteInfo = null;
  if (action === 'approve') {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(k.user_id);
    inviteInfo = grantInviteReward(user);
    if (user) refreshUserLevel(user.referrer_id);
  }
  res.json({ ok: true, inviteReward: inviteInfo ? { amount: inviteInfo.amount, referrer: inviteInfo.referrer.uid } : null });
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
  if ((user.kyc_status || '') !== 'verified') return res.status(403).json({ error: '请先完成实名认证（KYC）后再开启跟单' });
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(String(b.roomId || ''));
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const allocated = Number(b.amount) || 0;
  const stopLoss = Math.max(0, Math.min(99, Number(b.stopLoss) || 0));
  if (allocated > (user.available || 0)) return res.status(400).json({ error: '可用资金不足' });
  db.prepare('UPDATE users SET available = available - ?, total_assets = total_assets - ? WHERE id = ?').run(allocated, allocated, user.id);
  db.prepare('UPDATE rooms SET followers_count = followers_count + 1 WHERE id = ?').run(room.id);
  const st = db.prepare('INSERT INTO follows (uid, user_id, room_id, room_name, avatar, allocated, status, stop_loss, equity, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  st.run(uid, user.id, room.id, room.name, room.avatar, allocated, 'active', stopLoss, allocated, new Date().toISOString());
  // 被邀请用户参与跟单 → 解冻推荐人邀请奖励进可用余额
  unlockInviteRewards(user);
  refreshUserLevel(user.id);
  res.json({ ok: true });
});

app.get('/api/public/follows', (req, res) => {
  const uid = String(req.query.uid || '');
  if (!uid) return res.json([]);
  const rows = db.prepare('SELECT * FROM follows WHERE uid = ? ORDER BY id DESC').all(uid);
  res.json(rows.map(f => ({ id: f.id, roomId: f.room_id, roomName: f.room_name, avatar: f.avatar, allocated: f.allocated, status: f.status, stopLoss: f.stop_loss, stopTriggered: !!f.stop_triggered, equity: f.equity || f.allocated, createdAt: f.created_at, currentPnL: Math.round(((f.equity || f.allocated) - (f.allocated || 0)) * 100) / 100 })));
});

app.put('/api/public/follows/:id/pause', (req, res) => {
  const f = db.prepare('SELECT * FROM follows WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: '记录不存在' });
  const next = f.status === 'paused' ? 'active' : 'paused';
  db.prepare('UPDATE follows SET status = ? WHERE id = ?').run(next, f.id);
  res.json({ ok: true, status: next });
});

// 止损：确认结束跟单（剩余权益退回可用余额）
app.put('/api/public/follows/:id/stop', (req, res) => {
  const f = db.prepare('SELECT * FROM follows WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: '记录不存在' });
  if (f.status !== 'active') return res.status(400).json({ error: '该跟单已结束' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(f.user_id);
  const refund = Number((f.equity || f.allocated).toFixed(4));
  if (user && refund > 0) {
    db.prepare('UPDATE users SET available = available + ?, balance = balance + ?, total_assets = total_assets + ? WHERE id = ?').run(refund, refund, refund, user.id);
  }
  db.prepare("UPDATE follows SET status='ended', stop_triggered=0, ended_at=datetime('now','localtime') WHERE id=?").run(f.id);
  res.json({ ok: true, refund });
});

// 止损：取消（继续跟单分红）
app.put('/api/public/follows/:id/continue', (req, res) => {
  const f = db.prepare('SELECT * FROM follows WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: '记录不存在' });
  db.prepare('UPDATE follows SET stop_triggered = 0 WHERE id = ?').run(f.id);
  res.json({ ok: true });
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
  const metrics = computeMetrics(user.id);
  const frozen = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM invite_rewards WHERE referrer_uid=? AND status='frozen'").get(user.uid).s;
  const inviteRewards = db.prepare('SELECT * FROM invite_rewards WHERE referrer_uid = ? ORDER BY id DESC LIMIT 50').all(user.uid);
  const teamRewards = db.prepare('SELECT * FROM team_rewards WHERE uid = ? ORDER BY id DESC LIMIT 50').all(user.uid);
  const levelInfo = LEVEL_RULES[metrics.level];
  res.json({
    code: user.referral_code,
    userLevel: metrics.level,
    levelRule: levelInfo,
    directVerified: metrics.directVerified,
    teamVolume: metrics.volume,
    frozenInviteRewards: frozen,
    inviteRewards: inviteRewards.map(i => ({ id: i.id, referredName: i.referred_name, amount: i.amount, status: i.status, createdAt: i.created_at })),
    teamRewards: teamRewards.map(t => ({ id: t.id, kind: t.kind, amount: t.amount, level: t.level, source: t.source, createdAt: t.created_at })),
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
      frozenBalance: user.frozen_balance || 0,
      userLevel: user.user_level || 'L0',
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


// ================= 等级体系 / 团队 =================
const LEVEL_RULES = {
  L0: { directRate: 0.05, teamRate: 0, needDirect: 0, needVolume: 0 },
  L1: { directRate: 0.10, teamRate: 0.02, needDirect: 10, needVolume: 10000 },
  L2: { directRate: 0.20, teamRate: 0.04, needDirect: 20, needVolume: 100000 },
  L3: { directRate: 0.30, teamRate: 0.06, needDirect: 30, needVolume: 1000000 },
};

function getDescendants(userId) {
  const res = [];
  const stack = db.prepare('SELECT id FROM users WHERE referrer_id = ?').all(userId).map(r => r.id);
  while (stack.length) {
    const cur = stack.pop();
    res.push(cur);
    const kids = db.prepare('SELECT id FROM users WHERE referrer_id = ?').all(cur).map(r => r.id);
    for (const k of kids) stack.push(k);
  }
  return res;
}

function getDirectIds(userId) {
  return db.prepare('SELECT id FROM users WHERE referrer_id = ?').all(userId).map(r => r.id);
}

function computeMetrics(userId) {
  const directVerified = db.prepare("SELECT COUNT(*) c FROM users WHERE referrer_id=? AND kyc_status='verified'").get(userId).c;
  const directIds = getDirectIds(userId);
  const desc = getDescendants(userId);
  let volume = 0;
  if (desc.length) {
    const marks = desc.map(() => '?').join(',');
    volume = db.prepare("SELECT COALESCE(SUM(allocated),0) s FROM follows WHERE status='active' AND user_id IN (" + marks + ")").get(...desc).s || 0;
  }
  let level = 'L0';
  if (directVerified >= 30 && volume >= 1000000) level = 'L3';
  else if (directVerified >= 20 && volume >= 100000) level = 'L2';
  else if (directVerified >= 10 && volume >= 10000) level = 'L1';
  return { level, directVerified, volume, directIds, desc };
}

function refreshUserLevel(userId) {
  const m = computeMetrics(userId);
  db.prepare('UPDATE users SET user_level = ? WHERE id = ?').run(m.level, userId);
  return m;
}

function addAvailable(userId, amt) {
  if (amt > 0) db.prepare('UPDATE users SET balance = balance + ?, available = available + ?, total_income = total_income + ? WHERE id = ?').run(amt, amt, amt, userId);
}

// ================= 直推邀请奖励（注册实名 → 冻结钱包）=================
function grantInviteReward(referredUser) {
  if (!referredUser || !referredUser.referrer_id) return null;
  const ref = db.prepare('SELECT * FROM users WHERE id = ?').get(referredUser.referrer_id);
  if (!ref) return null;
  const count = db.prepare("SELECT COUNT(*) c FROM users WHERE referrer_id=? AND kyc_status='verified'").get(ref.id).c;
  const amount = count >= 30 ? 10 : count >= 10 ? 3 : 1;
  db.prepare('UPDATE users SET frozen_balance = frozen_balance + ? WHERE id = ?').run(amount, ref.id);
  const info = db.prepare('INSERT INTO invite_rewards (referrer_uid, referred_uid, referred_name, amount, status) VALUES (?,?,?,?,?)')
    .run(ref.uid, referredUser.uid, referredUser.name, amount, 'frozen');
  return { referrer: ref, amount, id: info.lastInsertRowid };
}

// 被邀请用户首次跟单 → 解冻邀请奖励进可用余额
function unlockInviteRewards(referredUser) {
  if (!referredUser || !referredUser.referrer_id) return 0;
  const rows = db.prepare("SELECT * FROM invite_rewards WHERE referred_uid=? AND status='frozen'").all(referredUser.uid);
  let total = 0;
  for (const row of rows) {
    db.prepare("UPDATE invite_rewards SET status='unlocked', unlocked_at=datetime('now','localtime') WHERE id=?").run(row.id);
    total += row.amount;
  }
  if (total > 0) {
    const ref = db.prepare('SELECT * FROM users WHERE id = ?').get(referredUser.referrer_id);
    if (ref) {
      db.prepare('UPDATE users SET frozen_balance = frozen_balance - ?, available = available + ?, balance = balance + ? WHERE id = ?').run(total, total, total, ref.id);
    }
  }
  return total;
}

// ================= 日化收益结算引擎 =================
function randBetween(min, max) { return Number((min + Math.random() * (max - min)).toFixed(4)); }

function settleDaily(req) {
  const today = new Date().toISOString().slice(0, 10);
  const force = !!(req && req.query && req.query.force);
  const done = db.prepare('SELECT COUNT(*) c FROM yield_records WHERE settle_date = ?').get(today).c;
  if (done > 0 && !force) return { skipped: true, count: 0, reason: '今天已结算' };
  const follows = db.prepare("SELECT * FROM follows WHERE status = 'active'").all();
  let count = 0;
  const profitByUid = {};
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
    const feePct = Number(room.performance_fee || 10);
    const custPct = Number(room.customer_share || 50);
    const user = db.prepare('SELECT * FROM users WHERE uid = ?').get(f.uid);
    if (!user) continue;
    if (profit >= 0) {
      const traderShare = Number((profit * feePct / 100).toFixed(4));
      const customerShare = Number((profit * custPct / 100).toFixed(4));
      const fundShare = Number((profit - traderShare - customerShare).toFixed(4));
      db.prepare('UPDATE users SET balance = balance + ?, available = available + ?, total_income = total_income + ? WHERE id = ?').run(customerShare, customerShare, customerShare, user.id);
      db.prepare('UPDATE rooms SET total_profit = total_profit + ?, leader_earnings = COALESCE(leader_earnings,0) + ? WHERE id = ?').run(profit, traderShare, room.id);
      db.prepare('INSERT INTO yield_records (follow_id,uid,room_id,room_name,principal,yield_rate,profit,trader_share,customer_share,fund_share,settle_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(f.id, f.uid, room.id, room.name, principal, yieldRate, profit, traderShare, customerShare, fundShare, today);
      if (fundShare > 0) db.prepare('UPDATE platform_pool SET balance = balance + ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = 1').run(fundShare);
      profitByUid[user.uid] = (profitByUid[user.uid] || 0) + profit;
      // 权益累计
      const curEquity = (f.equity || principal) + customerShare;
      db.prepare('UPDATE follows SET equity = ? WHERE id = ?').run(Number(curEquity.toFixed(4)), f.id);
    } else {
      // 亏损日：客户按本金全额承担亏损（分成比例仅作用于盈利）
      const loss = Math.abs(profit);
      const customerLoss = loss;
      if (customerLoss > 0) db.prepare('UPDATE users SET balance = balance - ?, available = available - ? WHERE id = ?').run(customerLoss, customerLoss, user.id);
      db.prepare('INSERT INTO yield_records (follow_id,uid,room_id,room_name,principal,yield_rate,profit,trader_share,customer_share,fund_share,settle_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(f.id, f.uid, room.id, room.name, principal, yieldRate, -loss, 0, -customerLoss, 0, today);
      const curEquity = (f.equity || principal) - customerLoss;
      db.prepare('UPDATE follows SET equity = ? WHERE id = ?').run(Number(curEquity.toFixed(4)), f.id);
      // 止损检查
      if (f.stop_loss > 0 && curEquity <= principal * (1 - f.stop_loss / 100)) {
        db.prepare('UPDATE follows SET stop_triggered = 1 WHERE id = ?').run(f.id);
      }
    }
    count++;
  }
  // 等级化推荐奖励：直推跟单奖励 + 团队收益奖励（从资金池支付）
  distributeLevelRewards(profitByUid, today);
  return { skipped: false, count };
}

function distributeLevelRewards(profitByUid, date) {
  const referrers = db.prepare('SELECT * FROM users WHERE id IN (SELECT DISTINCT referrer_id FROM users WHERE referrer_id IS NOT NULL)').all();
  for (const u of referrers) {
    const m = computeMetrics(u.id);
    db.prepare('UPDATE users SET user_level = ? WHERE id = ?').run(m.level, u.id);
    const rule = LEVEL_RULES[m.level];
    // 直推用户跟单收益奖励
    let directProfit = 0;
    for (const did of m.directIds) {
      const du = db.prepare('SELECT uid FROM users WHERE id = ?').get(did);
      if (du && profitByUid[du.uid]) directProfit += profitByUid[du.uid];
    }
    const directAmt = Number((directProfit * rule.directRate).toFixed(4));
    // 团队收益奖励（L1+）
    let teamProfit = 0;
    for (const did of m.desc) {
      const du = db.prepare('SELECT uid FROM users WHERE id = ?').get(did);
      if (du && profitByUid[du.uid]) teamProfit += profitByUid[du.uid];
    }
    const teamAmt = Number((teamProfit * rule.teamRate).toFixed(4));
    const pool = db.prepare('SELECT balance FROM platform_pool WHERE id = 1').get();
    let poolBalance = pool ? pool.balance : 0;
    if (directAmt > 0 && poolBalance > 0) {
      const pay = Math.min(directAmt, poolBalance);
      addAvailable(u.id, pay);
      db.prepare('UPDATE platform_pool SET balance = balance - ? WHERE id = 1').run(pay);
      db.prepare('INSERT INTO team_rewards (uid,user_name,level,kind,amount,source) VALUES (?,?,?,?,?,?)').run(u.uid, u.name, m.level, 'direct', pay, '直推跟单奖励 ' + date);
      poolBalance -= pay;
    }
    if (teamAmt > 0 && poolBalance > 0) {
      const pay = Math.min(teamAmt, poolBalance);
      addAvailable(u.id, pay);
      db.prepare('UPDATE platform_pool SET balance = balance - ? WHERE id = 1').run(pay);
      db.prepare('INSERT INTO team_rewards (uid,user_name,level,kind,amount,source) VALUES (?,?,?,?,?,?)').run(u.uid, u.name, m.level, 'team', pay, '团队收益奖励 ' + date);
    }
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

app.get('/api/admin/team-rewards', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM team_rewards ORDER BY id DESC LIMIT 200').all());
});

app.get('/api/admin/invite-rewards', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM invite_rewards ORDER BY id DESC LIMIT 200').all());
});

// 模拟房间亏损（用于测试止损）
app.post('/api/admin/rooms/:id/loss', auth, (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const pct = Math.abs(Number(req.body && req.body.pct) || 1);
  const follows = db.prepare("SELECT * FROM follows WHERE room_id=? AND status='active'").all(room.id);
  let affected = 0;
  for (const f of follows) {
    const loss = Number((f.allocated * pct / 100).toFixed(4));
    const user = db.prepare('SELECT * FROM users WHERE uid = ?').get(f.uid);
    if (!user) continue;
    const custLoss = loss;
    if (custLoss > 0) db.prepare('UPDATE users SET balance = balance - ?, available = available - ? WHERE id = ?').run(custLoss, custLoss, user.id);
    const equity = ((f.equity || f.allocated) - custLoss);
    db.prepare("INSERT INTO yield_records (follow_id,uid,room_id,room_name,principal,yield_rate,profit,trader_share,customer_share,fund_share,settle_date) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))")
      .run(f.id, f.uid, room.id, room.name, f.allocated, -pct, -loss, 0, -custLoss, 0);
    db.prepare('UPDATE follows SET equity = ? WHERE id = ?').run(Number(equity.toFixed(4)), f.id);
    if (f.stop_loss > 0 && equity <= f.allocated * (1 - f.stop_loss / 100)) {
      db.prepare('UPDATE follows SET stop_triggered = 1 WHERE id = ?').run(f.id);
    }
    affected++;
  }
  res.json({ ok: true, affected });
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

// ================= 二维码 / 上传 / 行情 =================
app.get('/api/public/qrcode', async (req, res) => {
  try {
    const text = String(req.query.text || 'https://elitetrade.onrender.com');
    const buf = await QRCode.toBuffer(text.slice(0, 500), { width: 260, margin: 1 });
    res.type('png').send(buf);
  } catch (e) { res.status(400).json({ error: '二维码生成失败' }); }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + String(file.originalname || 'img.png').replace(/[^a-zA-Z0-9.]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
app.post('/api/admin/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const url = '/uploads/' + req.file.filename;
  res.json({ ok: true, url, name: req.file.originalname });
});
app.use('/uploads', express.static(UPLOAD_DIR));

// ================= 交易品种（行情）管理 =================
app.get('/api/admin/quotes', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM quotes ORDER BY category, symbol').all());
});
app.post('/api/admin/quotes', auth, (req, res) => {
  const b = req.body || {};
  if (!b.symbol) return res.status(400).json({ error: '请输入品种代码' });
  db.prepare('INSERT OR REPLACE INTO quotes (symbol,name,price,ask_price,change_percent,category,api_id) VALUES (?,?,?,?,?,?,?)')
    .run(String(b.symbol).toUpperCase(), b.name || b.symbol, Number(b.price) || 0, Number(b.askPrice) || Number(b.price) || 0, Number(b.change) || 0, b.category || 'forex', b.apiId || null);
  res.json({ ok: true });
});
app.put('/api/admin/quotes/:symbol', auth, (req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM quotes WHERE symbol = ?').get(req.params.symbol);
  if (!cur) return res.status(404).json({ error: '品种不存在' });
  db.prepare('UPDATE quotes SET name=?, price=?, ask_price=?, change_percent=?, category=?, api_id=? WHERE symbol=?')
    .run(b.name ?? cur.name, b.price ?? cur.price, b.askPrice ?? cur.ask_price, b.change ?? cur.change_percent, b.category ?? cur.category, b.apiId ?? cur.api_id, req.params.symbol);
  res.json({ ok: true });
});
app.delete('/api/admin/quotes/:symbol', auth, (req, res) => {
  db.prepare('DELETE FROM quotes WHERE symbol = ?').run(req.params.symbol);
  res.json({ ok: true });
});
// 实时刷新加密币价格（CoinGecko 免费 API，无需 key）
app.post('/api/admin/quotes/refresh', auth, async (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM quotes WHERE category='crypto' AND api_id IS NOT NULL AND api_id != ''").all();
    const ids = rows.map(r => r.api_id).join(',');
    if (!ids) return res.json({ ok: true, updated: 0 });
    const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(ids) + '&vs_currencies=usd', { signal: AbortSignal.timeout(15000) });
    const j = await resp.json();
    let updated = 0;
    for (const r of rows) {
      const p = j[r.api_id] && j[r.api_id].usd;
      if (p) { db.prepare('UPDATE quotes SET price=?, ask_price=? WHERE symbol=?').run(p, p, r.symbol); db.prepare('INSERT INTO price_history (symbol, price) VALUES (?,?)').run(r.symbol, p); updated++; }
    }
    res.json({ ok: true, updated });
  } catch (e) { res.status(500).json({ error: '刷新失败: ' + e.message }); }
});
// 走势图历史
app.get('/api/public/quotes/history', (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  const rows = db.prepare('SELECT price, ts FROM price_history WHERE symbol = ? ORDER BY id DESC LIMIT 60').all(symbol);
  res.json(rows.reverse());
});
// 定时：加密币 5 分钟刷新一次
setInterval(async () => {
  try {
    const rows = db.prepare("SELECT * FROM quotes WHERE category='crypto' AND api_id IS NOT NULL AND api_id != ''").all();
    const ids = rows.map(r => r.api_id).join(',');
    if (!ids) return;
    const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(ids) + '&vs_currencies=usd', { signal: AbortSignal.timeout(12000) });
    const j = await resp.json();
    for (const r of rows) { const p = j[r.api_id] && j[r.api_id].usd; if (p) { db.prepare('UPDATE quotes SET price=?, ask_price=? WHERE symbol=?').run(p, p, r.symbol); db.prepare('INSERT INTO price_history (symbol, price) VALUES (?,?)').run(r.symbol, p); } }
  } catch (e) {}
}, 300000);

// ================= 团队总览（后台）=================
app.get('/api/admin/team', auth, (req, res) => {
  const users = db.prepare('SELECT id, uid, name, user_level, frozen_balance, kyc_status FROM users').all();
  const out = [];
  for (const u of users) {
    const m = computeMetrics(u.id);
    const direct = db.prepare('SELECT uid, name, kyc_status, user_level FROM users WHERE referrer_id = ?').all(u.id);
    out.push({ uid: u.uid, name: u.name, userLevel: u.user_level || 'L0', calcLevel: m.level, directVerified: m.directVerified, teamVolume: m.volume, frozenBalance: u.frozen_balance || 0, kycStatus: u.kyc_status, direct });
  }
  res.json(out);
});
app.get('/api/admin/fund-pool', auth, (req, res) => {
  const pool = db.prepare('SELECT balance FROM platform_pool WHERE id=1').get();
  res.json({ balance: pool ? pool.balance : 0 });
});

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