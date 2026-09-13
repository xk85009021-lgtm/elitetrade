import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, initDb } from './db.js';
import { sha256, randomDigits, timingSafeEqualText, generateTotpSecret, verifyTotp, otpauthUrl } from './security.js';
import QRCode from 'qrcode';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}
const JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'elitetrade-admin-secret-change-me-2026';
const USER_JWT_SECRET = process.env.USER_JWT_SECRET || process.env.JWT_SECRET || 'elitetrade-user-secret-change-me-2026';
const USER_TOKEN_TTL = process.env.USER_TOKEN_TTL || '7d';
const APP_TZ = process.env.APP_TZ || 'Asia/Singapore';
const MIN_FOLLOW_DAYS = Math.max(1, Number(process.env.MIN_FOLLOW_DAYS || 7));
const PORT = process.env.PORT || 8787;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
if (IS_PRODUCTION && (JWT_SECRET.includes('change-me') || USER_JWT_SECRET.includes('change-me'))) {
  console.error('FATAL: 生产环境必须配置 ADMIN_JWT_SECRET 和 USER_JWT_SECRET');
  process.exit(1);
}

initDb();

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ---------- helpers ----------
function bearerToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function auth(req, res, next) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function createUserSession(user, req) {
  const jti = crypto.randomUUID();
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  db.prepare('INSERT INTO user_sessions (jti,user_id,user_agent,ip) VALUES (?,?,?,?)').run(jti, user.id, userAgent, ip);
  return jwt.sign({ sub: user.id, uid: user.uid, jti }, USER_JWT_SECRET, { expiresIn: USER_TOKEN_TTL });
}

function userAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const claims = jwt.verify(token, USER_JWT_SECRET);
    const session = db.prepare('SELECT * FROM user_sessions WHERE jti=? AND revoked_at IS NULL').get(String(claims.jti || ''));
    if (!session) return res.status(401).json({ error: '登录已失效，请重新登录' });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(claims.sub));
    if (!user || user.status === 'frozen') return res.status(401).json({ error: '账户不存在或已冻结' });
    db.prepare("UPDATE user_sessions SET last_seen_at=datetime('now','localtime') WHERE id=?").run(session.id);
    req.user = user;
    req.session = session;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function requireUsableAccount(req, res) {
  if (req.user.emergency_frozen) {
    res.status(423).json({ error: '账户处于紧急冻结状态，请先在安全中心解除' });
    return false;
  }
  return true;
}

function addNotification(userId, title, body, type = 'system') {
  if (!userId) return;
  db.prepare('INSERT INTO notifications (user_id,title,body,type) VALUES (?,?,?,?)').run(userId, title, body, type);
}

function normalizeSqlDate(value) {
  const raw = String(value || '');
  if (!raw) return new Date(0).toISOString();
  if (raw.includes('T')) return raw;
  return raw.replace(' ', 'T') + '+08:00';
}

async function deliverResetCode(channel, destination, code, user) {
  if (channel === 'email') {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.PASSWORD_RESET_FROM || '盈透copy <noreply@example.com>';
    if (!key) {
      if (process.env.PASSWORD_RESET_CODE_IN_RESPONSE === 'true') {
        console.log('[password-reset]', destination, code);
        return;
      }
      throw new Error('邮件服务未配置，请联系管理员');
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [destination], subject: '盈透copy 密码重置验证码', html: '<p>您的验证码是 <b>' + code + '</b>，10 分钟内有效。</p>' })
    });
    if (!response.ok) throw new Error('邮件发送失败，请稍后重试');
    return;
  }
  const webhook = process.env.SMS_WEBHOOK_URL;
  if (!webhook) throw new Error('短信服务未配置，请联系管理员');
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.SMS_WEBHOOK_TOKEN ? { Authorization: 'Bearer ' + process.env.SMS_WEBHOOK_TOKEN } : {}) },
    body: JSON.stringify({ phone: destination, code, purpose: 'password_reset', userId: user.id })
  });
  if (!response.ok) throw new Error('短信发送失败，请稍后重试');
}

function ensureProjectGroup(projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!project) return null;
  let group = db.prepare('SELECT * FROM groups WHERE project_id=?').get(projectId);
  if (!group) {
    const info = db.prepare('INSERT INTO groups (project_id,name) VALUES (?,?)').run(projectId, project.title + ' 股东群');
    group = db.prepare('SELECT * FROM groups WHERE id=?').get(info.lastInsertRowid);
  }
  const investors = db.prepare('SELECT DISTINCT uid,user_id FROM investments WHERE project_id=?').all(projectId);
  for (const inv of investors) {
    const user = db.prepare('SELECT * FROM users WHERE uid=?').get(inv.uid);
    if (user) db.prepare('INSERT OR IGNORE INTO group_members (group_id,uid,user_name) VALUES (?,?,?)').run(group.id, user.uid, user.name);
  }
  return group;
}

function addAudit(actorType, actorId, action, targetType, targetId, detail) {
  try {
    db.prepare('INSERT INTO audit_logs (actor_type,actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?,?)')
      .run(actorType, String(actorId || ''), action, targetType || '', String(targetId || ''), detail ? JSON.stringify(detail) : '');
  } catch (e) {}
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
    status: r.status, sortOrder: r.sort_order, leaderUserId: r.leader_user_id || null, createdAt: r.created_at
  };
}
function toUser(u) {
  if (!u) return null;
  const { password, twofa_secret, ...safe } = u;
  return {
    ...safe,
    kycStatus: u.kyc_status,
    isVerified: !!u.is_verified,
    totalAssets: u.total_assets,
    totalIncome: u.total_income,
    referrerId: u.referrer_id,
    twofaEnabled: !!u.twofa_enabled,
    emergencyFrozen: !!u.emergency_frozen,
  };
}
const now = () => new Date().toISOString();
function round2(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }

// ---------- auth ----------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username || '').trim());
  if (!admin || !bcrypt.compareSync(String(password || ''), admin.password_hash)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: '12h' });
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
  const totalCommission = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM promotion_rewards').get().s;
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
  const rawPassword = String(b.password || '');
  if (rawPassword.length < 8) return res.status(400).json({ error: '新用户密码至少8位' });
  const passwordHash = bcrypt.hashSync(rawPassword, 10);
  db.prepare(`INSERT INTO users (uid,name,phone,email,password,balance,total_assets,available,total_income,frozen_balance,user_level,referral_code,referrer_id,level,status,kyc_status,is_verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uid, b.name || '', b.phone || '', b.email || '', passwordHash, Number(b.balance)||0, Number(b.balance)||0, (Number(b.available) ?? Number(b.balance)) || 0, Number(b.totalIncome)||0, Number(b.frozenBalance)||0, b.userLevel || 'V1', b.referralCode || ('ET-' + uid.slice(-6)), b.referrerId || null, levelNumber(b.userLevel || 'V1'), b.status || 'active', b.kycStatus || 'unverified', b.isVerified ? 1 : 0);
  addAudit('admin', req.admin.username, 'CREATE_USER', 'user', uid, { uid, name: b.name || '' });
  res.json({ ok: true, uid });
});

app.put('/api/users/:id', auth, (req, res) => {
  const id = req.params.id;
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '用户不存在' });
  const passwordHash = b.password !== undefined && String(b.password) !== ''
    ? bcrypt.hashSync(String(b.password), 10)
    : cur.password;
  db.prepare(`UPDATE users SET name=?, phone=?, email=?, password=?, balance=?, total_assets=?, available=?, total_income=?, frozen_balance=?, user_level=?, status=?, kyc_status=?, is_verified=?, level=? WHERE id=?`)
    .run(b.name ?? cur.name, b.phone ?? cur.phone, b.email ?? cur.email, passwordHash, b.balance ?? cur.balance, b.totalAssets ?? cur.total_assets, b.available ?? cur.available, b.totalIncome ?? cur.total_income, b.frozenBalance ?? cur.frozen_balance, b.userLevel ?? cur.user_level, b.status ?? cur.status, b.kycStatus ?? cur.kyc_status, b.isVerified !== undefined ? (b.isVerified ? 1 : 0) : cur.is_verified, b.userLevel ? levelNumber(b.userLevel) : cur.level, id);
  addAudit('admin', req.admin.username, 'UPDATE_USER', 'user', id, { passwordChanged: b.password !== undefined && String(b.password) !== '' });
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
  if (b.leaderUserId !== undefined) db.prepare('UPDATE rooms SET leader_user_id=? WHERE id=?').run(b.leaderUserId ? Number(b.leaderUserId) : null, id);
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
  db.prepare("UPDATE transactions SET status='expired', cancelled_at=datetime('now','localtime') WHERE type='deposit' AND status IN ('draft','pending') AND expires_at<>'' AND expires_at<?").run(new Date().toISOString());
  const status = String(req.query.status || '').trim();
  const type = String(req.query.type || '').trim();
  let sql = "SELECT * FROM transactions WHERE amount > 0 AND status <> 'draft'";
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.put('/api/transactions/:id/review', auth, (req, res) => {
  const { action, remark } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: '无效操作' });
  const run = db.transaction(() => {
    const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (!t) return { code: 404, error: '记录不存在' };
    if (t.status !== 'pending') return { code: 409, error: '该申请已处理，不能重复审核' };
    if (t.type === 'deposit' && t.expires_at && t.expires_at < new Date().toISOString()) {
      db.prepare("UPDATE transactions SET status='expired', cancelled_at=datetime('now','localtime') WHERE id=?").run(t.id);
      return { code: 410, error: '该充值订单已超过15分钟，不能继续审核' };
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(t.user_id);
    if (!user) return { code: 404, error: '用户不存在' };
    if (action === 'approve' && t.type === 'withdraw' && Number(t.amount) > Number(user.available || 0)) {
      return { code: 400, error: '用户可用余额不足，不能通过该提现' };
    }
    const status = action === 'approve' ? 'approved' : 'rejected';
    db.prepare('UPDATE transactions SET status=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=? AND status=?')
      .run(status, req.admin.username, now(), String(remark || ''), t.id, 'pending');
    if (action === 'approve') {
      if (t.type === 'deposit') {
        db.prepare('UPDATE users SET balance = balance + ?, total_assets = total_assets + ?, available = available + ? WHERE id = ?').run(t.amount, t.amount, t.amount, user.id);
        addNotification(user.id, '充值审核通过', '充值 ' + Number(t.amount).toFixed(2) + ' USDT 已到账。', 'deposit');
      } else if (t.type === 'withdraw') {
        db.prepare('UPDATE users SET balance = balance - ?, total_assets = total_assets - ?, available = available - ? WHERE id = ?').run(t.amount, t.amount, t.amount, user.id);
        addNotification(user.id, '提现审核通过', '提现 ' + Number(t.amount).toFixed(2) + ' USDT 已审核通过。', 'withdraw');
      }
    } else {
      addNotification(user.id, t.type === 'deposit' ? '充值审核未通过' : '提现审核未通过', remark || '请联系在线客服了解详情。', t.type);
    }
    addAudit('admin', req.admin.username, 'REVIEW_TRANSACTION_' + action.toUpperCase(), 'transaction', t.id, { type: t.type, amount: t.amount, status });
    return { ok: true };
  });
  const out = run();
  if (out.error) return res.status(out.code).json({ error: out.error });
  res.json(out);
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
  const { action, remark } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: '无效操作' });
  const run = db.transaction(() => {
    const k = db.prepare('SELECT * FROM kyc WHERE id = ?').get(req.params.id);
    if (!k) return { code: 404, error: '记录不存在' };
    if (k.status !== 'pending') return { code: 409, error: '该实名申请已处理，不能重复审核' };
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(k.user_id);
    if (!user) return { code: 404, error: '用户不存在' };
    const newStatus = action === 'approve' ? 'verified' : 'rejected';
    db.prepare('UPDATE kyc SET status=?, reviewed_by=?, reviewed_at=? WHERE id=? AND status=?')
      .run(newStatus, req.admin.username, now(), k.id, 'pending');
    db.prepare('UPDATE users SET kyc_status=?, is_verified=? WHERE id=?')
      .run(newStatus === 'verified' ? 'verified' : 'rejected', newStatus === 'verified' ? 1 : 0, k.user_id);
    let inviteInfo = null;
    if (action === 'approve') {
      inviteInfo = grantInviteReward(user);
      refreshUserLevel(user.referrer_id);
      addNotification(user.id, '实名认证通过', '您的实名认证已审核通过，可以开始跟单。', 'kyc');
    } else {
      addNotification(user.id, '实名认证未通过', remark || '请检查资料后重新提交。', 'kyc');
    }
    addAudit('admin', req.admin.username, 'REVIEW_KYC_' + action.toUpperCase(), 'kyc', k.id, { userId: user.id });
    return { ok: true, inviteReward: inviteInfo ? { amount: inviteInfo.amount, referrer: inviteInfo.referrer.uid } : null };
  });
  const out = run();
  if (out.error) return res.status(out.code).json({ error: out.error });
  res.json(out);
});

// ---------- V1-V5 推广收益 ----------
app.get('/api/admin/agent-levels', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM agent_level_config ORDER BY level').all());
});
app.put('/api/admin/agent-levels/:level', auth, (req, res) => {
  const level = levelNumber(req.params.level);
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM agent_level_config WHERE level=?').get(level);
  if (!cur) return res.status(404).json({ error: '等级不存在' });
  db.prepare(`UPDATE agent_level_config SET level_name=?,direct_valid_required=?,small_area_required=?,need_v4_count=?,direct_rate=?,lot_price=?,same_level_rate=?,upgrade_bonus=?,status=?,updated_at=datetime('now','localtime') WHERE level=?`)
    .run(b.levelName ?? cur.level_name, b.directValidRequired ?? cur.direct_valid_required, b.smallAreaRequired ?? cur.small_area_required, b.needV4Count ?? cur.need_v4_count, b.directRate ?? cur.direct_rate, b.lotPrice ?? cur.lot_price, b.sameLevelRate ?? cur.same_level_rate, b.upgradeBonus ?? cur.upgrade_bonus, b.status ?? cur.status, level);
  addAudit('admin', req.admin.username, 'UPDATE_AGENT_LEVEL', 'agent_level_config', level, b);
  res.json({ ok: true });
});
app.get('/api/admin/promotion-rewards', auth, (req, res) => {
  const date = String(req.query.date || '').trim();
  const type = String(req.query.type || '').trim();
  let sql = 'SELECT r.*, u.uid, u.name FROM promotion_rewards r LEFT JOIN users u ON u.id=r.member_id WHERE 1=1';
  const params = [];
  if (date) { sql += ' AND r.biz_date=?'; params.push(date); }
  if (type) { sql += ' AND r.reward_type=?'; params.push(type); }
  sql += ' ORDER BY r.id DESC LIMIT 1000';
  res.json(db.prepare(sql).all(...params));
});
app.get('/api/admin/upgrade-bonuses', auth, (req, res) => {
  res.json(db.prepare('SELECT b.*, u.uid, u.name, u.user_level FROM upgrade_bonuses b LEFT JOIN users u ON u.id=b.member_id ORDER BY b.id DESC LIMIT 500').all());
});
app.get('/api/admin/daily-team-volume', auth, (req, res) => {
  const date = String(req.query.date || businessDate()).trim();
  res.json(db.prepare('SELECT v.*, u.uid, u.name, u.user_level FROM daily_team_volume v LEFT JOIN users u ON u.id=v.member_id WHERE v.biz_date=? ORDER BY v.small_area_new_volume DESC LIMIT 1000').all(date));
});
app.get('/api/admin/notification-campaigns', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM notification_campaigns ORDER BY id DESC LIMIT 200').all());
});
app.post('/api/admin/notifications/publish', auth, (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const body = String(b.body || '').trim();
  if (!title || !body) return res.status(400).json({ error: '通知标题和内容不能为空' });
  const isPopup = b.isPopup ? 1 : 0;
  const type = String(b.type || 'system');
  const publishDate = businessDate();
  const tx = db.transaction(() => {
    const info = db.prepare('INSERT INTO notification_campaigns (title,body,type,is_popup,created_by) VALUES (?,?,?,?,?)').run(title, body, type, isPopup, req.admin.username);
    const users = db.prepare("SELECT id FROM users WHERE status='active'").all();
    const ins = db.prepare('INSERT INTO notifications (user_id,title,body,type,is_popup,popup_date,campaign_id) VALUES (?,?,?,?,?,?,?)');
    for (const user of users) ins.run(user.id, title, body, type, isPopup, isPopup ? publishDate : '', info.lastInsertRowid);
    addAudit('admin', req.admin.username, 'PUBLISH_NOTIFICATION', 'notification_campaign', info.lastInsertRowid, { title, isPopup, count: users.length });
    return { id: info.lastInsertRowid, count: users.length };
  });
  const out = tx();
  res.json({ ok: true, campaignId: out.id, recipients: out.count });
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
  const account = String(b.phone || b.email || '').trim();
  const password = String(b.password || '');
  if (!account) return res.status(400).json({ error: '请填写手机号或邮箱' });
  if (password.length < 8) return res.status(400).json({ error: '密码至少8位' });
  if (b.phone && db.prepare('SELECT id FROM users WHERE phone=?').get(String(b.phone).trim())) return res.status(409).json({ error: '手机号已注册' });
  if (b.email && db.prepare('SELECT id FROM users WHERE email=?').get(String(b.email).trim())) return res.status(409).json({ error: '邮箱已注册' });
  const uid = '10' + String(Math.floor(Math.random() * 900000) + 100000);
  const ref = 'ET-' + uid.slice(-6);
  let referrerId = null;
  if (b.referralCode) {
    const refUser = db.prepare('SELECT id FROM users WHERE referral_code=?').get(String(b.referralCode).trim());
    if (refUser) referrerId = refUser.id;
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(`INSERT INTO users (uid,name,phone,email,password,balance,referral_code,referrer_id,level,user_level,status,kyc_status) VALUES (?,?,?,?,?,0,?,?,1,'V1','active','unverified')`)
    .run(uid, String(b.name || '').trim(), String(b.phone || '').trim(), String(b.email || '').trim(), passwordHash, ref, referrerId);
  const user = db.prepare('SELECT * FROM users WHERE uid=?').get(uid);
  const token = createUserSession(user, req);
  addNotification(user.id, '欢迎使用盈透copy', '账户已创建，请完成实名认证后开始跟单。', 'account');
  res.json({ ok: true, uid, token, user: toUser(user) });
});

app.post('/api/public/login', (req, res) => {
  const b = req.body || {};
  const key = String(b.account || '').trim();
  const pwd = String(b.password || '');
  if (!key || !pwd) return res.status(400).json({ error: '请输入账号和密码' });
  const user = db.prepare('SELECT * FROM users WHERE phone=? OR email=? OR uid=?').get(key, key, key);
  if (!user) return res.status(401).json({ error: '账号或密码错误' });
  if (user.status === 'frozen') return res.status(403).json({ error: '账号已被冻结' });
  if (!user.password || !bcrypt.compareSync(pwd, user.password)) return res.status(401).json({ error: '账号或密码错误' });
  if (user.twofa_enabled) {
    const code = String(b.totpCode || '');
    if (!code) return res.json({ ok: false, requires2fa: true, message: '请输入谷歌验证器动态验证码' });
    if (!verifyTotp(user.twofa_secret, code)) return res.status(401).json({ error: '动态验证码错误' });
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  db.prepare('UPDATE users SET last_login_at=?, last_login_ip=? WHERE id=?').run(now(), ip, user.id);
  const token = createUserSession(user, req);
  res.json({ ok: true, token, user: toUser(user) });
});

app.post('/api/public/logout', userAuth, (req, res) => {
  db.prepare("UPDATE user_sessions SET revoked_at=datetime('now','localtime') WHERE id=?").run(req.session.id);
  res.json({ ok: true });
});

app.post('/api/public/password/reset/request', async (req, res) => {
  const channel = String((req.body || {}).channel || 'email');
  const account = String((req.body || {}).account || '').trim();
  if (!['email', 'phone'].includes(channel) || !account) return res.status(400).json({ error: '参数错误' });
  const user = db.prepare(channel === 'email' ? 'SELECT * FROM users WHERE email=?' : 'SELECT * FROM users WHERE phone=?').get(account);
  if (!user) return res.status(404).json({ error: '账号不存在' });
  const code = randomDigits(6);
  const codeHash = bcrypt.hashSync(code, 8);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('UPDATE password_reset_codes SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now(), user.id);
  db.prepare('INSERT INTO password_reset_codes (user_id,channel,destination,code_hash,expires_at) VALUES (?,?,?,?,?)').run(user.id, channel, account, codeHash, expiresAt);
  try {
    await deliverResetCode(channel, account, code, user);
  } catch (e) {
    return res.status(503).json({ error: e.message || '验证码发送服务未配置' });
  }
  res.json({ ok: true, expiresIn: 600, delivery: channel === 'email' ? '邮箱' : '短信' });
});

app.post('/api/public/password/reset/confirm', (req, res) => {
  const b = req.body || {};
  const channel = String(b.channel || 'email');
  const account = String(b.account || '').trim();
  const code = String(b.code || '').trim();
  const newPassword = String(b.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: '新密码至少8位' });
  const user = db.prepare(channel === 'email' ? 'SELECT * FROM users WHERE email=?' : 'SELECT * FROM users WHERE phone=?').get(account);
  if (!user) return res.status(404).json({ error: '账号不存在' });
  const row = db.prepare('SELECT * FROM password_reset_codes WHERE user_id=? AND channel=? AND destination=? AND used_at IS NULL ORDER BY id DESC LIMIT 1').get(user.id, channel, account);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ error: '验证码已过期，请重新获取' });
  if (Number(row.attempts || 0) >= 5) return res.status(429).json({ error: '验证码尝试次数过多，请重新获取' });
  if (!bcrypt.compareSync(code, row.code_hash)) {
    db.prepare('UPDATE password_reset_codes SET attempts=attempts+1 WHERE id=?').run(row.id);
    return res.status(401).json({ error: '验证码错误' });
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), user.id);
    db.prepare('UPDATE password_reset_codes SET used_at=? WHERE id=?').run(now(), row.id);
    db.prepare("UPDATE user_sessions SET revoked_at=datetime('now','localtime') WHERE user_id=? AND revoked_at IS NULL").run(user.id);
    addNotification(user.id, '登录密码已重置', '您的登录密码已更新，所有旧会话已下线。', 'security');
  });
  tx();
  res.json({ ok: true });
});

app.get('/api/public/user', userAuth, (req, res) => res.json({ ok: true, user: toUser(req.user) }));
app.get('/api/public/transactions', userAuth, (req, res) => {
  db.prepare("UPDATE transactions SET status='expired', cancelled_at=datetime('now','localtime') WHERE user_id=? AND type='deposit' AND status IN ('draft','pending') AND expires_at<>'' AND expires_at<?").run(req.user.id, new Date().toISOString());
  const rows = db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC').all(req.user.id);
  res.json(rows.map((t) => ({ id: t.id, txnId: t.txn_id, type: t.type, amount: t.amount, network: t.network, currency: t.currency, address: t.address, depositUid: t.deposit_uid, paymentQr: t.payment_qr, title: t.title, subtitle: t.subtitle, status: t.status, reviewNote: t.review_note, expiresAt: t.expires_at, cancelledAt: t.cancelled_at, subtitle: t.subtitle, createdAt: t.created_at })));
});

app.get('/api/public/deposit-address', userAuth, (req, res) => {
  const network = String(req.query.network || 'TRC20').trim();
  const currency = String(req.query.currency || 'USDT').trim();
  const row = db.prepare("SELECT id,network,currency,address,qr_url FROM deposit_addresses WHERE network=? AND currency=? AND status='active' ORDER BY RANDOM() LIMIT 1").get(network, currency);
  if (!row) return res.status(404).json({ error: '当前网络暂未配置可用充值地址' });
  res.json({ ...row, qrUrl: row.qr_url || ('/api/public/qrcode?text=' + encodeURIComponent(row.address)) });
});

app.post('/api/public/deposit', userAuth, (req, res) => {
  if (!requireUsableAccount(req, res)) return;
  const b = req.body || {};
  const amount = Number(b.amount || 0);
  const depositUid = String(b.depositUid || '').trim();
  const network = String(b.network || 'TRC20').trim();
  const currency = String(b.currency || 'USDT').trim();
  if (amount < 10) return res.status(400).json({ error: '最低充值金额为 10 USDT' });
  if (!depositUid) return res.status(400).json({ error: '请输入充值 UID' });
  if (depositUid !== String(req.user.uid)) return res.status(403).json({ error: '充值 UID 与当前登录账号不一致' });
  const addressRow = db.prepare("SELECT * FROM deposit_addresses WHERE network=? AND currency=? AND address=? AND status='active'").get(network, currency, String(b.address || '').trim());
  if (!addressRow) return res.status(400).json({ error: '充值地址已失效，请重新选择币种或网络' });
  const paymentQr = addressRow.qr_url || ('/api/public/qrcode?text=' + encodeURIComponent(addressRow.address));
  const txn = 'TXN-' + Date.now() + Math.floor(Math.random() * 1000);
  db.prepare(`INSERT INTO transactions (txn_id,user_id,user_name,type,amount,network,address,title,subtitle,status,date,time,deposit_uid,payment_qr,currency,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(txn, req.user.id, req.user.name, 'deposit', amount, network, addressRow.address, 'USDT Deposit', '充值待审核', 'pending', new Date().toISOString().slice(0, 10), new Date().toTimeString().slice(0, 5), depositUid, paymentQr, currency, '');
  addNotification(req.user.id, '充值申请已提交', '充值 ' + amount.toFixed(2) + ' USDT 正在等待后台审核，收款地址 ' + addressRow.address, 'deposit');
  res.json({ ok: true, txn, address: addressRow.address, qrUrl: paymentQr });
});

app.put('/api/public/deposit/orders/:id/cancel', userAuth, (req, res) => {
  const order = db.prepare("SELECT * FROM transactions WHERE id=? AND user_id=? AND type='deposit'").get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: '充值订单不存在' });
  if (!['draft', 'pending'].includes(order.status)) return res.status(409).json({ error: '该订单已不能取消' });
  db.prepare("UPDATE transactions SET status='cancelled', cancelled_at=datetime('now','localtime'), subtitle='用户已取消' WHERE id=?").run(order.id);
  addNotification(req.user.id, '充值订单已取消', '您已取消充值订单，可重新下单并生成新的随机地址。', 'deposit');
  res.json({ ok: true });
});

app.post('/api/public/withdraw', userAuth, (req, res) => {
  if (!requireUsableAccount(req, res)) return;
  const b = req.body || {};
  const amount = Number(b.amount || 0);
  const user = req.user;
  if (amount < 10) return res.status(400).json({ error: '最低提现金额为 10 USDT' });
  if (amount > Number(user.available || 0)) return res.status(400).json({ error: '提现金额超过可用余额' });
  if (!String(b.address || '').trim()) return res.status(400).json({ error: '请填写提现地址' });
  const earliestFollow = db.prepare("SELECT MIN(created_at) m FROM follows WHERE user_id=? AND status='active'").get(user.id);
  if (earliestFollow && earliestFollow.m) {
    const ageDays = (Date.now() - new Date(normalizeSqlDate(earliestFollow.m)).getTime()) / 86400000;
    if (ageDays < MIN_FOLLOW_DAYS) {
      const totalPrincipal = db.prepare("SELECT COALESCE(SUM(allocated),0) s FROM follows WHERE user_id=? AND status='active'").get(user.id).s;
      const totalWithdrawn = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE user_id=? AND type='withdraw' AND status='approved'").get(user.id).s;
      if (totalWithdrawn + amount > totalPrincipal) {
        return res.status(400).json({ error: '跟单未满 ' + MIN_FOLLOW_DAYS + ' 天：仅可累计提现跟单本金，收益到期后开放' });
      }
    }
  }
  const txn = 'TXN-' + Date.now() + Math.floor(Math.random() * 1000);
  db.prepare(`INSERT INTO transactions (txn_id,user_id,user_name,type,amount,network,address,title,subtitle,status,date,time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(txn, user.id, user.name, 'withdraw', amount, b.network || 'USDT-TRC20', b.address, 'USDT Withdraw', '提现待审核', 'pending', new Date().toISOString().slice(0, 10), new Date().toTimeString().slice(0, 5));
  addNotification(user.id, '提现申请已提交', '提现 ' + amount.toFixed(2) + ' USDT 正在等待后台审核。', 'withdraw');
  res.json({ ok: true, txn });
});

app.post('/api/public/kyc', userAuth, (req, res) => {
  if (!requireUsableAccount(req, res)) return;
  const b = req.body || {};
  if (!String(b.realName || '').trim() || !String(b.idNumber || '').trim()) return res.status(400).json({ error: '真实姓名和证件号码不能为空' });
  const pending = db.prepare("SELECT id FROM kyc WHERE user_id=? AND status='pending'").get(req.user.id);
  if (pending) return res.status(409).json({ error: '已有待审核的实名申请，请勿重复提交' });
  db.prepare(`INSERT INTO kyc (user_id,user_name,kyc_type,id_number,real_name,front_image,back_image,handheld_image,status) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, req.user.name, b.kycType || '身份证', b.idNumber, b.realName, b.frontImage || '', b.backImage || '', b.handheldImage || '', 'pending');
  addNotification(req.user.id, '实名申请已提交', '资料正在等待后台审核。', 'kyc');
  res.json({ ok: true });
});

app.post('/api/public/follow', userAuth, (req, res) => {
  if (!requireUsableAccount(req, res)) return;
  const b = req.body || {};
  const user = req.user;
  if ((user.kyc_status || '') !== 'verified') return res.status(403).json({ error: '请先完成实名认证（KYC）后再开启跟单' });
  const room = db.prepare("SELECT * FROM rooms WHERE id=? AND status='active'").get(String(b.roomId || ''));
  if (!room) return res.status(404).json({ error: '房间不存在或已下架' });
  const allocated = Number(b.amount || 0);
  const stopLoss = Math.max(0, Math.min(99, Number(b.stopLoss) || 0));
  if (allocated <= 0) return res.status(400).json({ error: '跟单金额无效' });
  if (allocated > Number(user.available || 0)) return res.status(400).json({ error: '可用资金不足' });
  const lockUntil = new Date(Date.now() + MIN_FOLLOW_DAYS * 86400000).toISOString();
  const tx = db.transaction(() => {
    const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (allocated > Number(fresh.available || 0)) throw new Error('可用资金不足');
    db.prepare('UPDATE users SET available=available-?, total_assets=balance WHERE id=?').run(allocated, user.id);
    db.prepare('UPDATE rooms SET followers_count=followers_count+1 WHERE id=?').run(room.id);
    db.prepare('INSERT INTO follows (uid,user_id,room_id,room_name,avatar,allocated,status,stop_loss,equity,lock_until,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(user.uid, user.id, room.id, room.name, room.avatar, allocated, 'active', stopLoss, allocated, lockUntil, now());
    unlockInviteRewards(user);
    refreshUserLevel(user.id);
    addNotification(user.id, '跟单已开启', '已跟随 ' + room.name + '，投入 ' + allocated.toFixed(2) + ' USDT，最低跟单周期 ' + MIN_FOLLOW_DAYS + ' 天。', 'follow');
  });
  try { tx(); } catch (e) { return res.status(400).json({ error: e.message }); }
  res.json({ ok: true, lockUntil, minDays: MIN_FOLLOW_DAYS });
});

app.get('/api/public/follows', userAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM follows WHERE user_id=? ORDER BY id DESC').all(req.user.id);
  res.json(rows.map((f) => {
    const unlockAt = f.lock_until || f.created_at;
    const unlockMs = new Date(normalizeSqlDate(unlockAt)).getTime();
    return { id: f.id, roomId: f.room_id, roomName: f.room_name, avatar: f.avatar, allocated: f.allocated, status: f.status, stopLoss: f.stop_loss, stopTriggered: !!f.stop_triggered, equity: f.equity || f.allocated, createdAt: f.created_at, lockUntil: f.lock_until, canExit: Date.now() >= unlockMs, remainingLockDays: Math.max(0, Math.ceil((unlockMs - Date.now()) / 86400000)), currentPnL: Math.round(((f.equity || f.allocated) - (f.allocated || 0)) * 100) / 100 };
  }));
});

app.put('/api/public/follows/:id/pause', userAuth, (req, res) => {
  const f = db.prepare('SELECT * FROM follows WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!f) return res.status(404).json({ error: '记录不存在' });
  if (f.status === 'ended') return res.status(400).json({ error: '该跟单已结束' });
  const next = f.status === 'paused' ? 'active' : 'paused';
  db.prepare('UPDATE follows SET status=? WHERE id=?').run(next, f.id);
  res.json({ ok: true, status: next });
});

app.put('/api/public/follows/:id/stop', userAuth, (req, res) => {
  if (!requireUsableAccount(req, res)) return;
  const f = db.prepare('SELECT * FROM follows WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!f) return res.status(404).json({ error: '记录不存在' });
  if (f.status === 'ended') return res.status(400).json({ error: '该跟单已结束' });
  const unlockMs = new Date(normalizeSqlDate(f.lock_until || f.created_at)).getTime();
  if (Date.now() < unlockMs) {
    return res.status(423).json({ error: '进入跟单房间后最低 ' + MIN_FOLLOW_DAYS + ' 天才能退出，剩余 ' + Math.max(1, Math.ceil((unlockMs - Date.now()) / 86400000)) + ' 天' });
  }
  const tx = db.transaction(() => {
    const fresh = db.prepare('SELECT * FROM follows WHERE id=?').get(f.id);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(f.user_id);
    const refund = Number((fresh.equity || fresh.allocated || 0).toFixed(4));
    if (refund > 0) db.prepare('UPDATE users SET available=available+?, total_assets=balance WHERE id=?').run(refund, user.id);
    db.prepare("UPDATE follows SET status='ended', stop_triggered=0, ended_at=datetime('now','localtime'), closed_reason=? WHERE id=?").run('manual', f.id);
    db.prepare('UPDATE rooms SET followers_count=MAX(0,followers_count-1) WHERE id=?').run(f.room_id);
    addNotification(user.id, '跟单已结束', f.room_name + ' 的剩余权益 ' + refund.toFixed(2) + ' USDT 已释放到可用余额。', 'follow');
    return refund;
  });
  const refund = tx();
  res.json({ ok: true, refund });
});

app.put('/api/public/follows/:id/continue', userAuth, (req, res) => {
  const f = db.prepare('SELECT * FROM follows WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!f) return res.status(404).json({ error: '记录不存在' });
  db.prepare('UPDATE follows SET stop_triggered=0 WHERE id=?').run(f.id);
  res.json({ ok: true });
});

app.get('/api/public/quotes', (req, res) => {
  res.json(db.prepare('SELECT symbol,name,price,ask_price as askPrice,change_percent as change,category,updated_at FROM quotes ORDER BY category,symbol').all());
});

app.get('/api/public/referral', userAuth, (req, res) => {
  const user = req.user;
  const configs = levelConfigMap();
  const metrics = computeMetrics(user.id);
  const frozen = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM invite_rewards WHERE referrer_uid=? AND status='frozen'").get(user.uid).s;
  const inviteRewards = db.prepare('SELECT * FROM invite_rewards WHERE referrer_uid=? ORDER BY id DESC LIMIT 100').all(user.uid);
  const promotionRewards = db.prepare('SELECT * FROM promotion_rewards WHERE member_id=? ORDER BY id DESC LIMIT 100').all(user.id);
  const upgradeBonuses = db.prepare('SELECT * FROM upgrade_bonuses WHERE member_id=? ORDER BY id DESC LIMIT 20').all(user.id);
  const totalReward = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM promotion_rewards WHERE member_id=?').get(user.id).s;
  res.json({
    code: user.referral_code,
    userLevel: metrics.level,
    levelRule: getLevelRule(metrics.level, configs),
    directVerified: metrics.directVerified,
    directCount: metrics.directCount,
    teamSize: metrics.desc.length,
    personalVolume: metrics.personalVolume,
    teamVolume: metrics.teamTotalVolume,
    teamTotalVolume: metrics.teamTotalVolume,
    largeAreaVolume: metrics.largeAreaVolume,
    smallAreaVolume: metrics.smallAreaVolume,
    branchVolumes: metrics.branchVolumes,
    savedV4: metrics.savedV4,
    nextLevel: metrics.nextLevel,
    progress: metrics.progress,
    frozenInviteRewards: frozen,
    inviteRewards: inviteRewards.map((item) => ({ id: item.id, referredName: item.referred_name, amount: item.amount, status: item.status, createdAt: item.created_at })),
    promotionRewards: promotionRewards.map((item) => ({ id: item.id, bizDate: item.biz_date, type: item.reward_type, amount: item.amount, baseAmount: item.base_amount, lots: item.standard_lots, rate: item.rate, unitPrice: item.unit_price, remark: item.remark, createdAt: item.created_at })),
    upgradeBonuses: upgradeBonuses.map((item) => ({ id: item.id, fromLevel: item.from_level, toLevel: item.to_level, amount: item.amount, status: item.status, qualifiedAt: item.qualified_at, holdUntil: item.hold_until, paidAt: item.paid_at })),
    totalReward,
    levels: Object.values(configs),
  });
});

app.put('/api/public/user/update', userAuth, (req, res) => {
  if (!requireUsableAccount(req, res)) return;
  const b = req.body || {};
  const name = String(b.name ?? req.user.name ?? '').trim();
  const email = String(b.email ?? req.user.email ?? '').trim();
  const phone = String(b.phone ?? req.user.phone ?? '').trim();
  if (!name) return res.status(400).json({ error: '姓名不能为空' });
  if (email && db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, req.user.id)) return res.status(409).json({ error: '邮箱已被使用' });
  if (phone && db.prepare('SELECT id FROM users WHERE phone=? AND id<>?').get(phone, req.user.id)) return res.status(409).json({ error: '手机号已被使用' });
  db.prepare('UPDATE users SET name=?,email=?,phone=?,avatar=? WHERE id=?').run(name, email, phone, String(b.avatar ?? req.user.avatar ?? ''), req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ ok: true, user: toUser(user) });
});

app.get('/api/public/overview', userAuth, (req, res) => {
  const user = req.user;
  const follows = db.prepare('SELECT * FROM follows WHERE user_id=?').all(user.id);
  const investments = db.prepare('SELECT * FROM investments WHERE user_id=?').all(user.id);
  const myCopyAlloc = follows.filter((f) => f.status === 'active').reduce((sum, f) => sum + Number(f.allocated || 0), 0);
  const myCopyPnl = follows.reduce((sum, f) => sum + (Number(f.equity || f.allocated || 0) - Number(f.allocated || 0)), 0);
  const myInvest = investments.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const commission = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM promotion_rewards WHERE member_id=?').get(user.id).s;
  const todayProfit = db.prepare('SELECT COALESCE(SUM(customer_share),0) s FROM yield_records WHERE uid=? AND settle_date=?').get(user.uid, businessDate()).s;
  res.json({ user: toUser(user), stats: { totalAssets: user.total_assets, balance: user.balance, frozenBalance: user.frozen_balance || 0, userLevel: user.user_level || 'V1', available: user.available, totalIncome: user.total_income, myCopyAlloc, myCopyPnl: Number(myCopyPnl.toFixed(4)), myInvest, commission, todayProfit, minFollowDays: MIN_FOLLOW_DAYS } });
});

app.post('/api/public/invest', userAuth, (req, res) => {
  if (!requireUsableAccount(req, res)) return;
  const b = req.body || {};
  const project = db.prepare("SELECT * FROM projects WHERE id=? AND status='active'").get(String(b.projectId || ''));
  if (!project) return res.status(404).json({ error: '项目不存在或已下架' });
  const amount = Number(b.amount || 0);
  if (amount < Number(project.min_investment || 0)) return res.status(400).json({ error: '低于项目最低投资金额' });
  if (amount > Number(req.user.available || 0)) return res.status(400).json({ error: '可用余额不足' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance=balance-?,available=available-?,total_assets=balance-? WHERE id=?').run(amount, amount, amount, req.user.id);
    db.prepare('INSERT INTO investments (uid,user_id,project_id,project_title,amount) VALUES (?,?,?,?,?)').run(req.user.uid, req.user.id, project.id, project.title, amount);
    const invested = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM investments WHERE project_id=?').get(project.id).s;
    const target = parseFloat(String(project.target_amount || '0').replace(/[^0-9.]/g, '')) || 0;
    const progress = target > 0 ? Math.min(100, Math.round(invested / target * 1000) / 10) : project.progress;
    db.prepare('UPDATE projects SET progress=? WHERE id=?').run(progress, project.id);
    if (progress >= 100) {
      const grp = ensureProjectGroup(project.id);
      if (grp) db.prepare('INSERT OR IGNORE INTO group_members (group_id,uid,user_name) VALUES (?,?,?)').run(grp.id, req.user.uid, req.user.name);
    }
    addNotification(req.user.id, '众筹认购成功', project.title + ' 认购 ' + amount.toFixed(2) + ' USDT 已入账。', 'invest');
    return { groupCreated: progress >= 100, progress };
  });
  const out = tx();
  res.json({ ok: true, ...out });
});

// ---------- user security, notifications, support and lead trader ----------
app.get('/api/public/notifications/today-popup', userAuth, (req, res) => {
  const popupDate = businessDate();
  const row = db.prepare(`
    SELECT n.* FROM notifications n
    WHERE n.user_id=? AND n.is_popup=1 AND n.popup_date=?
      AND NOT EXISTS (SELECT 1 FROM notification_popup_views v WHERE v.user_id=n.user_id AND v.notification_id=n.id AND v.popup_date=n.popup_date)
    ORDER BY n.id DESC LIMIT 1
  `).get(req.user.id, popupDate);
  if (!row) return res.json({ ok: true, notification: null });
  db.prepare('INSERT OR IGNORE INTO notification_popup_views (user_id,notification_id,popup_date) VALUES (?,?,?)').run(req.user.id, row.id, popupDate);
  res.json({ ok: true, notification: row });
});

app.get('/api/public/notifications', userAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id));
});
app.put('/api/public/notifications/:id/read', userAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});
app.put('/api/public/notifications/read-all', userAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

app.post('/api/public/security/password', userAuth, (req, res) => {
  const b = req.body || {};
  const oldPassword = String(b.oldPassword || '');
  const newPassword = String(b.newPassword || '');
  if (!bcrypt.compareSync(oldPassword, req.user.password)) return res.status(401).json({ error: '原密码错误' });
  if (newPassword.length < 8) return res.status(400).json({ error: '新密码至少8位' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
    db.prepare("UPDATE user_sessions SET revoked_at=datetime('now','localtime') WHERE user_id=? AND jti<>? AND revoked_at IS NULL").run(req.user.id, req.session.jti);
    addNotification(req.user.id, '登录密码已修改', '其他设备会话已全部下线。', 'security');
  });
  tx();
  res.json({ ok: true });
});

app.get('/api/public/security/sessions', userAuth, (req, res) => {
  const rows = db.prepare("SELECT id,jti,user_agent,ip,created_at,last_seen_at FROM user_sessions WHERE user_id=? AND revoked_at IS NULL ORDER BY id DESC").all(req.user.id);
  res.json(rows.map((r) => ({ ...r, current: r.jti === req.session.jti })));
});
app.delete('/api/public/security/sessions/:id', userAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM user_sessions WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: '会话不存在' });
  if (row.jti === req.session.jti) return res.status(400).json({ error: '不能移除当前会话' });
  db.prepare("UPDATE user_sessions SET revoked_at=datetime('now','localtime') WHERE id=?").run(row.id);
  res.json({ ok: true });
});

app.post('/api/public/security/2fa/setup', userAuth, async (req, res) => {
  if (req.user.twofa_enabled) return res.status(409).json({ error: '双重验证已启用' });
  const secret = generateTotpSecret();
  db.prepare('UPDATE users SET twofa_secret=?,twofa_enabled=0 WHERE id=?').run(secret, req.user.id);
  const url = otpauthUrl(secret, req.user.email || req.user.phone || req.user.uid, '盈透copy');
  const qr = await QRCode.toDataURL(url);
  res.json({ ok: true, secret, otpauthUrl: url, qr });
});
app.post('/api/public/security/2fa/enable', userAuth, (req, res) => {
  const secret = req.user.twofa_secret;
  if (!secret) return res.status(400).json({ error: '请先获取2FA密钥' });
  if (!verifyTotp(secret, (req.body || {}).code)) return res.status(400).json({ error: '动态验证码错误' });
  db.prepare('UPDATE users SET twofa_enabled=1 WHERE id=?').run(req.user.id);
  addNotification(req.user.id, '双重验证已启用', '谷歌验证器双重验证已启用。', 'security');
  res.json({ ok: true });
});
app.post('/api/public/security/2fa/disable', userAuth, (req, res) => {
  const b = req.body || {};
  if (!bcrypt.compareSync(String(b.password || ''), req.user.password)) return res.status(401).json({ error: '登录密码错误' });
  if (!verifyTotp(req.user.twofa_secret, b.code)) return res.status(400).json({ error: '动态验证码错误' });
  db.prepare("UPDATE users SET twofa_enabled=0,twofa_secret='' WHERE id=?").run(req.user.id);
  addNotification(req.user.id, '双重验证已关闭', '账户双重验证已关闭。', 'security');
  res.json({ ok: true });
});

app.post('/api/public/security/freeze', userAuth, (req, res) => {
  const enabled = !!(req.body || {}).enabled;
  const password = String((req.body || {}).password || '');
  if (!bcrypt.compareSync(password, req.user.password)) return res.status(401).json({ error: '登录密码错误' });
  db.prepare('UPDATE users SET emergency_frozen=? WHERE id=?').run(enabled ? 1 : 0, req.user.id);
  addNotification(req.user.id, enabled ? '账户已紧急冻结' : '账户紧急冻结已解除', enabled ? '所有资金与跟单操作已暂停。' : '账户操作已恢复。', 'security');
  res.json({ ok: true, emergencyFrozen: enabled });
});

app.get('/api/public/support/thread', userAuth, (req, res) => {
  let thread = db.prepare('SELECT * FROM support_threads WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
  if (!thread) {
    const info = db.prepare("INSERT INTO support_threads (user_id,subject) VALUES (?,'在线客服')").run(req.user.id);
    thread = db.prepare('SELECT * FROM support_threads WHERE id=?').get(info.lastInsertRowid);
  }
  const messages = db.prepare('SELECT * FROM support_messages WHERE thread_id=? ORDER BY id ASC').all(thread.id);
  res.json({ thread, messages });
});
app.post('/api/public/support/messages', userAuth, (req, res) => {
  const content = String((req.body || {}).content || '').trim();
  if (!content) return res.status(400).json({ error: '消息不能为空' });
  let thread = db.prepare('SELECT * FROM support_threads WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
  if (!thread) {
    const info = db.prepare("INSERT INTO support_threads (user_id,subject) VALUES (?,'在线客服')").run(req.user.id);
    thread = db.prepare('SELECT * FROM support_threads WHERE id=?').get(info.lastInsertRowid);
  }
  db.prepare('INSERT INTO support_messages (thread_id,sender_type,sender_id,content) VALUES (?,?,?,?)').run(thread.id, 'user', req.user.id, content);
  db.prepare("UPDATE support_threads SET status='open',updated_at=datetime('now','localtime') WHERE id=?").run(thread.id);
  res.json({ ok: true });
});

app.get('/api/public/lead-trader', userAuth, (req, res) => {
  const application = db.prepare('SELECT * FROM lead_trader_applications WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
  const rooms = db.prepare('SELECT * FROM rooms WHERE leader_user_id=? ORDER BY id DESC').all(req.user.id).map(toRoom);
  const earnings = db.prepare('SELECT COALESCE(SUM(leader_earnings),0) s FROM rooms WHERE leader_user_id=?').get(req.user.id).s;
  res.json({ application, rooms, earnings });
});
app.post('/api/public/lead-trader/apply', userAuth, (req, res) => {
  const b = req.body || {};
  const pending = db.prepare("SELECT id FROM lead_trader_applications WHERE user_id=? AND status='pending'").get(req.user.id);
  if (pending) return res.status(409).json({ error: '已有待审核的带单申请' });
  db.prepare('INSERT INTO lead_trader_applications (user_id,experience,strategy,contact) VALUES (?,?,?,?)').run(req.user.id, String(b.experience || ''), String(b.strategy || ''), String(b.contact || ''));
  addNotification(req.user.id, '带单申请已提交', '平台将在收到申请后完成资质审核。', 'lead');
  res.json({ ok: true });
});

app.get('/api/public/yields', userAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM yield_records WHERE uid=? ORDER BY id DESC').all(req.user.uid));
});
app.get('/api/public/rewards', userAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM promotion_rewards WHERE member_id=? ORDER BY id DESC LIMIT 200').all(req.user.id);
  res.json(rows.map((item) => ({
    ...item,
    rewardType: item.reward_type,
    baseAmount: item.base_amount,
    standardLots: item.standard_lots,
    unitPrice: item.unit_price,
    bizDate: item.biz_date,
    createdAt: item.created_at
  })));
});
app.get('/api/public/groups', userAuth, (req, res) => {
  res.json(db.prepare('SELECT g.* FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.uid=? ORDER BY g.id DESC').all(req.user.uid));
});
app.get('/api/public/groups/:id/messages', userAuth, (req, res) => {
  const member = db.prepare('SELECT 1 ok FROM group_members WHERE group_id=? AND uid=?').get(req.params.id, req.user.uid);
  if (!member) return res.status(403).json({ error: '您不在该股东群中' });
  res.json(db.prepare('SELECT * FROM group_messages WHERE group_id=? ORDER BY id ASC').all(req.params.id));
});
app.post('/api/public/groups/:id/message', userAuth, (req, res) => {
  const content = String((req.body || {}).content || '').trim();
  if (!content) return res.status(400).json({ error: '消息不能为空' });
  const member = db.prepare('SELECT 1 ok FROM group_members WHERE group_id=? AND uid=?').get(req.params.id, req.user.uid);
  if (!member) return res.status(403).json({ error: '您不在该股东群中' });
  db.prepare('INSERT INTO group_messages (group_id,uid,user_name,content) VALUES (?,?,?,?)').run(req.params.id, req.user.uid, req.user.name, content);
  res.json({ ok: true });
});

// ================= 等级体系 / 团队 =================
function levelNumber(value) {
  const match = String(value || 'V1').toUpperCase().match(/V(\d)/);
  return Math.max(1, Math.min(5, match ? Number(match[1]) : 1));
}

function levelName(value) {
  return 'V' + levelNumber(value);
}

function levelConfigMap() {
  const rows = db.prepare('SELECT * FROM agent_level_config WHERE status=1 ORDER BY level').all();
  const map = {};
  for (const row of rows) {
    map[row.level] = {
      level: row.level,
      levelName: row.level_name,
      directRequired: Number(row.direct_valid_required || 0),
      smallAreaRequired: Number(row.small_area_required || 0),
      needV4Count: Number(row.need_v4_count || 0),
      directRate: Number(row.direct_rate || 0),
      lotPrice: Number(row.lot_price || 0),
      sameLevelRate: Number(row.same_level_rate || 0),
      upgradeBonus: Number(row.upgrade_bonus || 0),
    };
  }
  return map;
}

function getLevelRule(value, map) {
  const rules = map || levelConfigMap();
  return rules[levelNumber(value)] || rules[1];
}

function getUplineChain(memberId) {
  const chain = [];
  let current = db.prepare('SELECT referrer_id FROM users WHERE id=?').get(memberId);
  const seen = new Set([Number(memberId)]);
  while (current && current.referrer_id && !seen.has(Number(current.referrer_id)) && chain.length < 100) {
    const upId = Number(current.referrer_id);
    chain.push(upId);
    seen.add(upId);
    current = db.prepare('SELECT referrer_id FROM users WHERE id=?').get(upId);
  }
  return chain;
}

function directValidIds(memberId) {
  return db.prepare(`
    SELECT u.id
    FROM users u
    WHERE u.referrer_id=?
      AND u.kyc_status='verified'
      AND u.status='active'
      AND EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.user_id=u.id AND t.type='deposit' AND t.status='approved' AND t.amount>0
      )
  `).all(memberId).map((row) => Number(row.id));
}

function activePrincipalOf(userIds) {
  if (!userIds.length) return 0;
  const marks = userIds.map(() => '?').join(',');
  return Number(db.prepare("SELECT COALESCE(SUM(allocated),0) s FROM follows WHERE status='active' AND user_id IN (" + marks + ")").get(...userIds).s || 0);
}

function dailyNewVolumeOf(userIds, bizDate) {
  if (!userIds.length) return 0;
  const marks = userIds.map(() => '?').join(',');
  return Number(db.prepare("SELECT COALESCE(SUM(allocated),0) s FROM follows WHERE date(created_at)=? AND user_id IN (" + marks + ")").get(bizDate, ...userIds).s || 0);
}

function v4DescendantCount(memberId) {
  const desc = getDescendants(memberId);
  if (!desc.length) return 0;
  const marks = desc.map(() => '?').join(',');
  return Number(db.prepare("SELECT COUNT(*) c FROM users WHERE id IN (" + marks + ") AND user_level='V4' AND status='active'").get(...desc).c || 0);
}

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
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  const configs = levelConfigMap();
  const directIds = getDirectIds(userId);
  const directValid = directValidIds(userId);
  const desc = getDescendants(userId);
  const personalVolume = activePrincipalOf([userId]);
  const teamTotalVolume = activePrincipalOf(desc);
  const branchVolumes = directIds.map((id) => ({ memberId: id, volume: activePrincipalOf([id, ...getDescendants(id)]) }));
  const largestBranchVolume = branchVolumes.reduce((max, branch) => Math.max(max, Number(branch.volume || 0)), 0);
  const smallAreaVolume = Math.max(0, teamTotalVolume - largestBranchVolume);
  const savedV4 = v4DescendantCount(userId);
  let qualifiedLevel = 1;
  for (let level = 5; level >= 1; level--) {
    const rule = configs[level];
    if (!rule) continue;
    if (directValid.length >= rule.directRequired && smallAreaVolume >= rule.smallAreaRequired && savedV4 >= rule.needV4Count) {
      qualifiedLevel = level;
      break;
    }
  }
  const currentLevel = levelNumber(user ? user.user_level : 'V1');
  const nextRule = currentLevel < 5 ? configs[currentLevel + 1] : null;
  const directProgress = nextRule ? Math.min(100, directValid.length / nextRule.directRequired * 100) : 100;
  const volumeProgress = nextRule ? Math.min(100, smallAreaVolume / nextRule.smallAreaRequired * 100) : 100;
  const v4Progress = nextRule && nextRule.needV4Count > 0 ? Math.min(100, savedV4 / nextRule.needV4Count * 100) : null;
  return {
    level: 'V' + currentLevel,
    currentLevel,
    qualifiedLevel,
    qualifiedLevelName: 'V' + qualifiedLevel,
    directCount: directIds.length,
    directVerified: directValid.length,
    directIds,
    directValidIds: directValid,
    desc,
    personalVolume,
    teamTotalVolume,
    volume: teamTotalVolume,
    branchVolumes,
    largestBranchVolume,
    largeAreaVolume: largestBranchVolume,
    smallAreaVolume,
    savedV4,
    nextLevel: nextRule,
    progress: {
      direct: Number(directProgress.toFixed(1)),
      volume: Number(volumeProgress.toFixed(1)),
      v4: v4Progress === null ? 100 : Number(v4Progress.toFixed(1)),
      overall: nextRule ? Number((([directProgress, volumeProgress].concat(v4Progress === null ? [] : [v4Progress])).reduce((a, b) => a + b, 0) / ([directProgress, volumeProgress].concat(v4Progress === null ? [] : [v4Progress])).length).toFixed(1)) : 100,
    },
  };
}

function reconcileAgentLevel(user, metrics, bizDate) {
  const configs = levelConfigMap();
  const currentLevel = levelNumber(user.user_level);
  const qualifiedLevel = metrics.qualifiedLevel;
  const nowIso = new Date().toISOString();
  if (qualifiedLevel > currentLevel) {
    db.prepare('UPDATE users SET user_level=?, level_since=?, level_fail_months=0 WHERE id=?').run('V' + qualifiedLevel, nowIso, user.id);
    for (let level = currentLevel + 1; level <= qualifiedLevel; level++) {
      const rule = configs[level];
      if (!rule || rule.upgradeBonus <= 0) continue;
      const exists = db.prepare("SELECT id FROM upgrade_bonuses WHERE member_id=? AND to_level=? AND status IN ('pending','paid')").get(user.id, 'V' + level);
      if (!exists) {
        const holdUntil = new Date(Date.now() + 30 * 86400000).toISOString();
        db.prepare('INSERT INTO upgrade_bonuses (member_id,from_level,to_level,amount,status,qualified_at,hold_until) VALUES (?,?,?,?,?,?,?)').run(user.id, 'V' + (level - 1), 'V' + level, rule.upgradeBonus, 'pending', bizDate, holdUntil);
      }
    }
    user.user_level = 'V' + qualifiedLevel;
    return;
  }
  const month = String(bizDate).slice(0, 7);
  if (qualifiedLevel < currentLevel) {
    if (String(user.level_checked_month || '') !== month) {
      const failMonths = Number(user.level_fail_months || 0) + 1;
      if (failMonths >= 2) {
        db.prepare("UPDATE upgrade_bonuses SET status='cancelled', remark=? WHERE member_id=? AND status='pending' AND CAST(SUBSTR(to_level,2) AS INTEGER)>?").run('连续2个月未达标降级，晋级奖失效', user.id, qualifiedLevel);
        db.prepare('UPDATE users SET user_level=?, level_fail_months=0, level_checked_month=?, level_since=? WHERE id=?').run('V' + qualifiedLevel, month, nowIso, user.id);
        user.user_level = 'V' + qualifiedLevel;
      } else {
        db.prepare('UPDATE users SET level_fail_months=?, level_checked_month=? WHERE id=?').run(failMonths, month, user.id);
      }
    }
    return;
  }
  db.prepare('UPDATE users SET level_fail_months=0, level_checked_month=? WHERE id=?').run(month, user.id);
}

function payDueUpgradeBonuses() {
  const rows = db.prepare(`
    SELECT b.*, u.user_level, u.status, u.emergency_frozen, u.level_since
    FROM upgrade_bonuses b JOIN users u ON u.id=b.member_id
    WHERE b.status='pending' AND b.hold_until<=?
  `).all(new Date().toISOString());
  for (const bonus of rows) {
    if (bonus.user_level !== bonus.to_level || bonus.status !== 'active' || bonus.emergency_frozen) continue;
    const levelSince = new Date(bonus.level_since || 0).getTime();
    if (!levelSince || levelSince > new Date(bonus.hold_until).getTime()) continue;
    const tx = db.transaction(() => {
      const fresh = db.prepare("SELECT * FROM upgrade_bonuses WHERE id=? AND status='pending'").get(bonus.id);
      if (!fresh) return;
      db.prepare('UPDATE upgrade_bonuses SET status=?, paid_at=? WHERE id=?').run('paid', new Date().toISOString(), bonus.id);
      addAvailable(bonus.member_id, Number(bonus.amount));
      addNotification(bonus.member_id, '晋级奖励已发放', bonus.to_level + ' 晋级奖励 ' + Number(bonus.amount).toFixed(2) + ' USDT 已到账。', 'upgrade');
    });
    tx();
  }
}

function refreshUserLevel(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) return null;
  const metrics = computeMetrics(userId);
  reconcileAgentLevel(user, metrics, businessDate());
  return computeMetrics(userId);
}

function addAvailable(userId, amt) {
  if (amt > 0) db.prepare('UPDATE users SET balance = balance + ?, available = available + ?, total_income = total_income + ?, total_assets = balance + ? WHERE id = ?').run(amt, amt, amt, amt, userId);
}

// ================= 直推邀请奖励（注册实名 → 冻结钱包）=================
function grantInviteReward(referredUser) {
  if (!referredUser || !referredUser.referrer_id) return null;
  const ref = db.prepare('SELECT * FROM users WHERE id = ?').get(referredUser.referrer_id);
  if (!ref) return null;
  const count = db.prepare("SELECT COUNT(*) c FROM users WHERE referrer_id=? AND kyc_status='verified'").get(ref.id).c;
  const amount = count >= 30 ? 10 : count >= 10 ? 3 : 1;
  db.prepare('UPDATE users SET frozen_balance = frozen_balance + ?, balance = balance + ?, total_assets = balance + ? WHERE id = ?').run(amount, amount, amount, ref.id);
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
      db.prepare('UPDATE users SET frozen_balance = frozen_balance - ?, available = available + ? WHERE id = ?').run(total, total, ref.id);
    }
  }
  return total;
}

// ================= 日化收益结算引擎（房间统一收益率） =================
function randBetween(min, max) { return Number((min + Math.random() * (max - min)).toFixed(4)); }

function timeZoneParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '00';
  return { year: get('year'), month: get('month'), day: get('day'), hour: Number(get('hour')), minute: Number(get('minute')) };
}

function businessDate(date = new Date()) {
  const p = timeZoneParts(date);
  return p.year + '-' + p.month + '-' + p.day;
}

function roomYieldForDate(room, bizDate) {
  const existing = db.prepare('SELECT yield_rate FROM room_daily_yields WHERE room_id=? AND biz_date=?').get(room.id, bizDate);
  if (existing) return Number(existing.yield_rate);
  const minY = Number(room.daily_yield_min ?? 0.1);
  const maxY = Number(room.daily_yield_max ?? 0.5);
  const rate = randBetween(Math.min(minY, maxY), Math.max(minY, maxY));
  db.prepare('INSERT OR IGNORE INTO room_daily_yields (room_id,biz_date,yield_rate) VALUES (?,?,?)').run(room.id, bizDate, rate);
  return Number(db.prepare('SELECT yield_rate FROM room_daily_yields WHERE room_id=? AND biz_date=?').get(room.id, bizDate).yield_rate);
}

function settleDaily(req) {
  const isManualSettlement = !!(req && req.query);
  const bizDate = isManualSettlement ? businessDate() : businessDate(new Date(Date.now() - 12 * 60 * 60 * 1000));
  const force = !!(req && req.query && req.query.force);
  const done = db.prepare('SELECT COUNT(*) c FROM yield_records WHERE settle_date=?').get(bizDate).c;
  if (done > 0 && !force) return { skipped: true, count: 0, reason: '今天已结算', bizDate };
  const follows = db.prepare("SELECT * FROM follows WHERE status='active'").all();
  let count = 0;
  const profitByUid = {};
  const roomRateCache = new Map();
  for (const f of follows) {
    const already = db.prepare('SELECT COUNT(*) c FROM yield_records WHERE follow_id=? AND settle_date=?').get(f.id, bizDate).c;
    if (already > 0) continue;
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(f.room_id);
    if (!room || room.daily_yield_min == null) continue;
    const principal = Number(f.allocated || 0);
    if (principal <= 0) continue;
    if (!roomRateCache.has(room.id)) roomRateCache.set(room.id, roomYieldForDate(room, bizDate));
    const yieldRate = roomRateCache.get(room.id);
    const profit = Number((principal * yieldRate / 100).toFixed(4));
    const feePct = Math.max(0, Math.min(100, Number(room.performance_fee || 0)));
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(f.user_id);
    if (!user) continue;
    if (profit >= 0) {
      const traderShare = Number((profit * feePct / 100).toFixed(4));
      const customerShare = Number((profit - traderShare).toFixed(4));
      db.prepare('UPDATE users SET balance=balance+?,available=available+?,total_income=total_income+?,total_assets=balance+? WHERE id=?').run(customerShare, customerShare, customerShare, customerShare, user.id);
      db.prepare('UPDATE rooms SET total_profit=total_profit+?,leader_earnings=COALESCE(leader_earnings,0)+? WHERE id=?').run(profit, traderShare, room.id);
      if (room.leader_user_id && traderShare > 0) {
        addAvailable(Number(room.leader_user_id), traderShare);
        addNotification(Number(room.leader_user_id), '绩效费到账', room.name + ' 当日绩效费 ' + traderShare.toFixed(4) + ' USDT 已进入可用余额。', 'performance');
      }
      db.prepare('INSERT INTO yield_records (follow_id,uid,room_id,room_name,principal,yield_rate,profit,trader_share,customer_share,fund_share,settle_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(f.id, f.uid, room.id, room.name, principal, yieldRate, profit, traderShare, customerShare, 0, bizDate);
      profitByUid[user.uid] = (profitByUid[user.uid] || 0) + profit;
      const curEquity = Number(f.equity || principal) + customerShare;
      db.prepare('UPDATE follows SET equity=? WHERE id=?').run(Number(curEquity.toFixed(4)), f.id);
      addNotification(user.id, '跟单收益到账', room.name + ' 当日收益率 ' + yieldRate.toFixed(4) + '%，到账 ' + customerShare.toFixed(4) + ' USDT。', 'yield');
    } else {
      const loss = Math.abs(profit);
      db.prepare('UPDATE users SET balance=balance-?,total_assets=balance-? WHERE id=?').run(loss, loss, user.id);
      db.prepare('INSERT INTO yield_records (follow_id,uid,room_id,room_name,principal,yield_rate,profit,trader_share,customer_share,fund_share,settle_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(f.id, f.uid, room.id, room.name, principal, yieldRate, -loss, 0, -loss, 0, bizDate);
      const curEquity = Number(f.equity || principal) - loss;
      db.prepare('UPDATE follows SET equity=? WHERE id=?').run(Number(curEquity.toFixed(4)), f.id);
      addNotification(user.id, '跟单出现亏损', room.name + ' 当日亏损 ' + loss.toFixed(4) + ' USDT。', 'yield');
      if (Number(f.stop_loss || 0) > 0 && curEquity <= principal * (1 - Number(f.stop_loss) / 100)) {
        db.prepare('UPDATE follows SET stop_triggered=1 WHERE id=?').run(f.id);
      }
    }
    count++;
  }
  settleAgentPromotion(profitByUid, bizDate);
  return { skipped: false, count, bizDate, timezone: APP_TZ };
}

function settleAgentPromotion(profitByUid, bizDate) {
  const configs = levelConfigMap();
  const users = db.prepare("SELECT * FROM users WHERE status='active'").all();
  const snaps = new Map();

  for (const user of users) {
    const metrics = computeMetrics(user.id);
    reconcileAgentLevel(user, metrics, bizDate);
    const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    const dailyTeamVolume = dailyNewVolumeOf(metrics.desc, bizDate);
    const dailyBranches = metrics.directIds.map((id) => ({ memberId: id, volume: dailyNewVolumeOf([id, ...getDescendants(id)], bizDate) }));
    const dailyLargest = dailyBranches.reduce((max, branch) => Math.max(max, Number(branch.volume || 0)), 0);
    const dailySmall = Math.max(0, dailyTeamVolume - dailyLargest);
    const standardLots = Number((dailySmall / 2000).toFixed(4));
    db.prepare(`INSERT INTO daily_team_volume (member_id,biz_date,team_new_volume,largest_branch_volume,small_area_new_volume,standard_lots,branch_json)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(member_id,biz_date) DO UPDATE SET team_new_volume=excluded.team_new_volume,largest_branch_volume=excluded.largest_branch_volume,small_area_new_volume=excluded.small_area_new_volume,standard_lots=excluded.standard_lots,branch_json=excluded.branch_json`)
      .run(user.id, bizDate, dailyTeamVolume, dailyLargest, dailySmall, standardLots, JSON.stringify(dailyBranches));
    snaps.set(user.id, { user: fresh, metrics, dailyTeamVolume, dailyLargest, dailySmall, standardLots });
  }

  const rewards = [];
  const lotIncome = new Map();
  const addReward = (reward) => {
    if (reward && Number(reward.amount) > 0) rewards.push(reward);
  };

  for (const [memberId, snap] of snaps) {
    const rule = getLevelRule(snap.user.user_level, configs);
    let directProfit = 0;
    if (snap.metrics.directIds.length) {
      const marks = snap.metrics.directIds.map(() => '?').join(',');
      directProfit = Number(db.prepare("SELECT COALESCE(SUM(customer_share),0) s FROM yield_records WHERE settle_date=? AND customer_share>0 AND uid IN (SELECT uid FROM users WHERE id IN (" + marks + "))").get(bizDate, ...snap.metrics.directIds).s || 0);
    }
    const directAmount = round2(directProfit * rule.directRate);
    addReward({ bizDate, memberId, type: 'direct_profit', fromMemberId: null, baseAmount: round2(directProfit), lots: 0, rate: rule.directRate, unitPrice: 0, amount: directAmount, remark: '一代直推当日净利润 ' + round2(directProfit).toFixed(2) + ' × ' + (rule.directRate * 100).toFixed(0) + '%' });

    const lotAmount = round2(snap.standardLots * rule.lotPrice);
    addReward({ bizDate, memberId, type: 'lot_bonus', fromMemberId: null, baseAmount: snap.dailySmall, lots: snap.standardLots, rate: 0, unitPrice: rule.lotPrice, amount: lotAmount, remark: '小区新增跟单业绩 ' + snap.dailySmall.toFixed(2) + ' ÷ 2000 × ' + rule.lotPrice + ' USD/手' });
    if (lotAmount > 0) lotIncome.set(memberId, round2((lotIncome.get(memberId) || 0) + lotAmount));
  }

  const sortedIds = Array.from(snaps.keys()).sort((a, b) => a - b);
  for (const originId of sortedIds) {
    const origin = snaps.get(originId);
    if (!origin || origin.standardLots <= 0) continue;
    let previousPrice = getLevelRule(origin.user.user_level, configs).lotPrice;
    for (const uplineId of getUplineChain(originId)) {
      const upline = snaps.get(uplineId);
      if (!upline) continue;
      const uplinePrice = getLevelRule(upline.user.user_level, configs).lotPrice;
      if (uplinePrice > previousPrice) {
        const diff = uplinePrice - previousPrice;
        const amount = round2(diff * origin.standardLots);
        addReward({ bizDate, memberId: uplineId, type: 'differential', fromMemberId: originId, baseAmount: 0, lots: origin.standardLots, rate: 0, unitPrice: diff, amount, remark: '级差 ' + uplinePrice + '-' + previousPrice + '=' + diff + ' USD/手 × ' + origin.standardLots.toFixed(4) + ' 手' });
        if (amount > 0) lotIncome.set(uplineId, round2((lotIncome.get(uplineId) || 0) + amount));
        previousPrice = uplinePrice;
      }
    }
  }

  for (const childId of sortedIds) {
    const child = snaps.get(childId);
    if (!child || !child.user.referrer_id) continue;
    const parent = snaps.get(Number(child.user.referrer_id));
    if (!parent || levelNumber(child.user.user_level) !== levelNumber(parent.user.user_level)) continue;
    const childLevel = levelNumber(child.user.user_level);
    if (childLevel < 2) continue;
    const base = round2(lotIncome.get(childId) || 0);
    const rule = getLevelRule(parent.user.user_level, configs);
    const amount = round2(base * rule.sameLevelRate);
    addReward({ bizDate, memberId: parent.user.id, type: 'same_level', fromMemberId: childId, baseAmount: base, lots: 0, rate: rule.sameLevelRate, unitPrice: 0, amount, remark: '同级团队手数返佣 ' + base.toFixed(2) + ' × ' + (rule.sameLevelRate * 100).toFixed(0) + '%' });
  }

  const tx = db.transaction(() => {
    for (const reward of rewards) {
      const exists = db.prepare('SELECT id FROM promotion_rewards WHERE biz_date=? AND member_id=? AND reward_type=? AND IFNULL(from_member_id,0)=IFNULL(?,0)').get(reward.bizDate, reward.memberId, reward.type, reward.fromMemberId);
      if (exists) continue;
      db.prepare('INSERT INTO promotion_rewards (biz_date,member_id,reward_type,from_member_id,base_amount,standard_lots,rate,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(reward.bizDate, reward.memberId, reward.type, reward.fromMemberId, reward.baseAmount, reward.lots, reward.rate, reward.unitPrice, reward.amount, reward.remark);
      addAvailable(reward.memberId, reward.amount);
      addNotification(reward.memberId, '推广奖励到账', reward.remark + '，奖励 ' + reward.amount.toFixed(4) + ' USDT。', 'reward');
    }
  });
  tx();
  payDueUpgradeBonuses();
  return rewards.length;
}

// 定时结算：按新加坡时区每天 06:00 执行一次
setInterval(() => {
  const p = timeZoneParts();
  if (p.hour === 6 && p.minute < 10) {
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
  res.json(db.prepare(`SELECT r.*, u.uid, u.name, u.user_level FROM promotion_rewards r LEFT JOIN users u ON u.id=r.member_id ORDER BY r.id DESC LIMIT 200`).all());
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
    if (custLoss > 0) db.prepare('UPDATE users SET balance = balance - ?, total_assets = balance - ? WHERE id = ?').run(custLoss, custLoss, user.id);
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
// ================= 二维码 / 上传 / 行情 =================
app.get('/api/public/qrcode', async (req, res) => {
  try {
    const requestBase = (req.headers['x-forwarded-proto'] || req.protocol || 'https') + '://' + (req.headers['x-forwarded-host'] || req.get('host'));
    const text = String(req.query.text || process.env.APP_URL || requestBase);
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
app.post('/api/public/upload/avatar', userAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(url, req.user.id);
  res.json({ ok: true, url });
});
app.post('/api/public/upload/kyc', userAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  res.json({ ok: true, url: '/uploads/' + req.file.filename });
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
  db.prepare("UPDATE quotes SET name=?, price=?, ask_price=?, change_percent=?, category=?, api_id=?, updated_at=datetime('now','localtime') WHERE symbol=?")
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
    const rows = db.prepare("SELECT * FROM quotes WHERE category='crypto'").all();
    const prices = await fetchCryptoPrices(rows);
    let updated = 0;
    for (const r of rows) {
      const p = prices[r.symbol] || prices[String(r.symbol).replace('/','')] || prices[String(r.symbol).split('/')[0]];
      if (p) { db.prepare("UPDATE quotes SET price=?, ask_price=?, updated_at=datetime('now','localtime') WHERE symbol=?").run(p, p, r.symbol); db.prepare('INSERT INTO price_history (symbol, price) VALUES (?,?)').run(r.symbol, p); updated++; }
    }
    if (updated === 0) {
      const msg = rows.length === 0
        ? '没有可刷新的加密品种（请在「行情品种」中新增或检查分类为 crypto）'
        : '未能从行情源获取价格：请确认服务器可访问外网（Coinbase/Binance/CoinGecko），或该品种尚未配置可用代码';
      return res.json({ ok: false, updated: 0, message: msg, candidates: rows.length });
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

async function fetchCryptoPrices(rows) {
  const out = {};
  // 1) Coinbase (US 服务器可访问、免 key)：BTC-USD / ETH-USD / SOL-USD
  try {
    const bases = [...new Set(rows.map(r => String(r.symbol || '').split('/')[0]).filter(Boolean))];
    const results = await Promise.all(bases.map(async (b) => {
      try {
        const resp = await fetch('https://api.coinbase.com/v2/prices/' + b + '-USD/spot', { signal: AbortSignal.timeout(8000) });
        const j = await resp.json();
        return { base: b, price: j && j.data && Number(j.data.amount) };
      } catch (e) { return { base: b, price: null }; }
    }));
    for (const res of results) { if (res.price) out[res.base] = res.price; }
    if (Object.keys(out).length >= rows.length) return out;
  } catch (e) {}
  // 2) Binance 兜底
  try {
    const bn = rows.map(r => String(r.symbol || '').replace(/\//g, ''));
    const resp = await fetch('https://api.binance.com/api/v3/ticker/price?symbols=' + encodeURIComponent(JSON.stringify(bn)), { signal: AbortSignal.timeout(8000) });
    const j = await resp.json();
    if (Array.isArray(j)) { for (const item of j) { const sym = String(item.symbol || '').replace('USDT', '/USDT'); if (item.price) out[sym] = Number(item.price); } }
  } catch (e) {}
  // 3) CoinGecko 兜底（按 api_id）
  try {
    const ids = rows.map(r => r.api_id).filter(Boolean).join(',');
    if (ids) {
      const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(ids) + '&vs_currencies=usd', { signal: AbortSignal.timeout(8000) });
      const j = await resp.json();
      for (const r of rows) { const p = j[r.api_id] && j[r.api_id].usd; if (p) out[r.symbol] = p; }
    }
  } catch (e) {}
  return out;
}

// 定时：加密币 5 分钟刷新一次
setInterval(async () => {
  try {
    const rows = db.prepare("SELECT * FROM quotes WHERE category='crypto'").all();
    const prices = await fetchCryptoPrices(rows);
    for (const r of rows) {
      const p = prices[r.symbol] || prices[String(r.symbol).replace('/','')] || prices[String(r.symbol).split('/')[0]];
      if (p) { db.prepare('UPDATE quotes SET price=?, ask_price=? WHERE symbol=?').run(p, p, r.symbol); db.prepare('INSERT INTO price_history (symbol, price) VALUES (?,?)').run(r.symbol, p); }
    }
  } catch (e) {}
}, 300000);

// ================= 团队总览（后台）=================
app.get('/api/admin/team', auth, (req, res) => {
  const users = db.prepare('SELECT id, uid, name, user_level, frozen_balance, kyc_status FROM users').all();
  const out = [];
  for (const u of users) {
    const m = computeMetrics(u.id);
    const direct = db.prepare('SELECT uid, name, kyc_status, user_level FROM users WHERE referrer_id = ?').all(u.id);
    out.push({ uid: u.uid, name: u.name, userLevel: u.user_level || 'V1', calcLevel: m.level, directVerified: m.directVerified, personalVolume: m.personalVolume, largeAreaVolume: m.largestBranchVolume, smallAreaVolume: m.smallAreaVolume, teamVolume: m.teamTotalVolume, teamTotalVolume: m.teamTotalVolume, frozenBalance: u.frozen_balance || 0, kycStatus: u.kyc_status, direct });
  }
  res.json(out);
});
app.get('/api/admin/deposit-addresses', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM deposit_addresses ORDER BY network,currency,sort_order,id DESC').all());
});
app.post('/api/admin/deposit-addresses', auth, (req, res) => {
  const b = req.body || {};
  const network = String(b.network || '').trim();
  const currency = String(b.currency || 'USDT').trim();
  const address = String(b.address || '').trim();
  if (!network || !address) return res.status(400).json({ error: '网络和充值地址不能为空' });
  try {
    const info = db.prepare('INSERT INTO deposit_addresses (network,currency,address,qr_url,status,sort_order) VALUES (?,?,?,?,?,?)').run(network, currency, address, String(b.qrUrl || ''), b.status || 'active', Number(b.sortOrder) || 0);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) { res.status(409).json({ error: '该网络下地址已存在' }); }
});
app.put('/api/admin/deposit-addresses/:id', auth, (req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM deposit_addresses WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '充值地址不存在' });
  db.prepare("UPDATE deposit_addresses SET network=?,currency=?,address=?,qr_url=?,status=?,sort_order=?,updated_at=datetime('now','localtime') WHERE id=?")
    .run(b.network ?? cur.network, b.currency ?? cur.currency, b.address ?? cur.address, b.qrUrl ?? cur.qr_url, b.status ?? cur.status, b.sortOrder ?? cur.sort_order, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/deposit-addresses/:id', auth, (req, res) => {
  db.prepare('DELETE FROM deposit_addresses WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/support-threads', auth, (req, res) => {
  const rows = db.prepare(`SELECT t.*, u.uid, u.name, (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id=t.id) message_count FROM support_threads t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC`).all();
  res.json(rows);
});
app.get('/api/admin/support-threads/:id/messages', auth, (req, res) => {
  const thread = db.prepare('SELECT * FROM support_threads WHERE id=?').get(req.params.id);
  if (!thread) return res.status(404).json({ error: '工单不存在' });
  res.json({ thread, messages: db.prepare('SELECT * FROM support_messages WHERE thread_id=? ORDER BY id ASC').all(thread.id) });
});
app.post('/api/admin/support-threads/:id/reply', auth, (req, res) => {
  const thread = db.prepare('SELECT * FROM support_threads WHERE id=?').get(req.params.id);
  if (!thread) return res.status(404).json({ error: '工单不存在' });
  const content = String((req.body || {}).content || '').trim();
  if (!content) return res.status(400).json({ error: '回复不能为空' });
  db.prepare('INSERT INTO support_messages (thread_id,sender_type,sender_id,content) VALUES (?,?,?,?)').run(thread.id, 'admin', req.admin.id, content);
  db.prepare("UPDATE support_threads SET status='replied',updated_at=datetime('now','localtime') WHERE id=?").run(thread.id);
  addNotification(thread.user_id, '客服已回复', content.slice(0, 120), 'support');
  res.json({ ok: true });
});
app.get('/api/admin/lead-trader-applications', auth, (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.uid, u.name, u.phone, u.email, u.kyc_status FROM lead_trader_applications a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC`).all();
  res.json(rows);
});
app.post('/api/admin/lead-trader-applications/:id/review', auth, (req, res) => {
  const action = String((req.body || {}).action || '');
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: '无效操作' });
  const appRow = db.prepare('SELECT * FROM lead_trader_applications WHERE id=?').get(req.params.id);
  if (!appRow) return res.status(404).json({ error: '申请不存在' });
  if (appRow.status !== 'pending') return res.status(409).json({ error: '该申请已处理' });
  const status = action === 'approve' ? 'approved' : 'rejected';
  db.prepare('UPDATE lead_trader_applications SET status=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status=?').run(status, req.admin.username, now(), appRow.id, 'pending');
  addNotification(appRow.user_id, action === 'approve' ? '带单申请已通过' : '带单申请未通过', action === 'approve' ? '请联系运营人员配置带单房间。' : '请完善资料后重新申请。', 'lead');
  addAudit('admin', req.admin.username, 'REVIEW_LEAD_TRADER_' + action.toUpperCase(), 'lead_application', appRow.id, { userId: appRow.user_id });
  res.json({ ok: true });
});
app.get('/api/admin/audit-logs', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500').all());
});

// ---------- static ----------
const ADMIN_DIST = path.join(ROOT, 'admin-dist');
const FRONT_DIST = path.join(ROOT, 'frontend-dist');

app.use('/admin', express.static(ADMIN_DIST, { etag: false, maxAge: 0, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
app.use('/admin', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.sendFile(path.join(ADMIN_DIST, 'index.html')); });
app.use(express.static(FRONT_DIST));
app.use((req, res) => res.sendFile(path.join(FRONT_DIST, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`盈透copy Admin Server running on http://localhost:${PORT}`);
  console.log(`- Admin UI: http://localhost:${PORT}/admin`);
  console.log(`- Frontend: http://localhost:${PORT}/`);
  console.log(`- API: http://localhost:${PORT}/api/...`);
});