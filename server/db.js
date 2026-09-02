import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'elitetrade.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'superadmin',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT UNIQUE,
      name TEXT,
      phone TEXT,
      email TEXT,
      password TEXT,
      balance REAL DEFAULT 0,
      total_assets REAL DEFAULT 0,
      available REAL DEFAULT 0,
      total_income REAL DEFAULT 0,
      referral_code TEXT,
      referrer_id INTEGER,
      level INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      kyc_status TEXT DEFAULT 'unverified',
      is_verified INTEGER DEFAULT 0,
      avatar TEXT DEFAULT '',
      frozen_balance REAL DEFAULT 0,
      user_level TEXT DEFAULT 'L0',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT,
      english_name TEXT,
      avatar TEXT,
      tags TEXT,
      total_profit REAL DEFAULT 0,
      yield_rate REAL DEFAULT 0,
      max_drawdown REAL DEFAULT 0,
      running_days INTEGER DEFAULT 0,
      followers_count INTEGER DEFAULT 0,
      total_aum TEXT,
      win_rate REAL DEFAULT 0,
      risk_level TEXT,
      description TEXT,
      sparkline TEXT,
      monthly_return REAL DEFAULT 0,
      avg_daily_return REAL DEFAULT 0,
      max_profit_single REAL DEFAULT 0,
      max_loss_single REAL DEFAULT 0,
      avg_profit REAL DEFAULT 0,
      avg_loss REAL DEFAULT 0,
      lots REAL DEFAULT 0,
      win_trades INTEGER DEFAULT 0,
      loss_trades INTEGER DEFAULT 0,
      asset_distribution TEXT,
      category TEXT DEFAULT 'forex',
      is_hot INTEGER DEFAULT 0,
      daily_yield_min REAL DEFAULT 0.1,
      daily_yield_max REAL DEFAULT 0.5,
      performance_fee REAL DEFAULT 10,
      customer_share REAL DEFAULT 50,
      fund_share REAL DEFAULT 40,
      status TEXT DEFAULT 'active',
      sort_order INTEGER DEFAULT 0,
      leader_earnings REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT,
      subtitle TEXT,
      image TEXT,
      progress REAL DEFAULT 0,
      estimated_yield REAL DEFAULT 0,
      target_amount TEXT,
      min_investment REAL DEFAULT 0,
      exit_route TEXT,
      team TEXT,
      category TEXT,
      raised_amount TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      txn_id TEXT,
      user_id INTEGER,
      user_name TEXT,
      type TEXT,
      amount REAL,
      network TEXT,
      address TEXT,
      title TEXT,
      subtitle TEXT,
      status TEXT DEFAULT 'pending',
      date TEXT,
      time TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS kyc (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      kyc_type TEXT,
      id_number TEXT,
      real_name TEXT,
      front_image TEXT,
      back_image TEXT,
      handheld_image TEXT,
      status TEXT DEFAULT 'pending',
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      level INTEGER DEFAULT 1,
      amount REAL DEFAULT 0,
      rate REAL DEFAULT 0,
      order_id TEXT,
      status TEXT DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS content_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      type TEXT DEFAULT 'text',
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT,
      user_id INTEGER,
      room_id TEXT,
      room_name TEXT,
      avatar TEXT,
      allocated REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS quotes (
      symbol TEXT PRIMARY KEY,
      name TEXT,
      price REAL DEFAULT 0,
      ask_price REAL DEFAULT 0,
      change_percent REAL DEFAULT 0,
      category TEXT DEFAULT 'precious',
      api_id TEXT
    );
    CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT,
      user_id INTEGER,
      project_id TEXT,
      project_title TEXT,
      amount REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS yield_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follow_id INTEGER,
      uid TEXT,
      room_id TEXT,
      room_name TEXT,
      principal REAL DEFAULT 0,
      yield_rate REAL DEFAULT 0,
      profit REAL DEFAULT 0,
      trader_share REAL DEFAULT 0,
      customer_share REAL DEFAULT 0,
      fund_share REAL DEFAULT 0,
      settle_date TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      project_title TEXT,
      name TEXT,
      invite_code TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER,
      uid TEXT,
      user_name TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER,
      uid TEXT,
      user_name TEXT,
      content TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS referral_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_uid TEXT,
      from_name TEXT,
      to_uid TEXT,
      to_name TEXT,
      level INTEGER DEFAULT 1,
      amount REAL DEFAULT 0,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS platform_pool (
      id INTEGER PRIMARY KEY,
      balance REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS fund_pool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL DEFAULT 0,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      price REAL,
      ts TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS invite_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_uid TEXT,
      referred_uid TEXT,
      referred_name TEXT,
      amount REAL DEFAULT 0,
      status TEXT DEFAULT 'frozen',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      unlocked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS fund_pool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      balance REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS team_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT,
      user_name TEXT,
      level TEXT,
      kind TEXT,
      amount REAL DEFAULT 0,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS commission_rates (
      level INTEGER PRIMARY KEY,
      rate REAL DEFAULT 0
    );
  `);


  // ensure rooms daily-yield/fee columns exist
  try { db.exec("ALTER TABLE rooms ADD COLUMN daily_yield_min REAL DEFAULT 0.1"); } catch (e) {}
  try { db.exec("ALTER TABLE rooms ADD COLUMN daily_yield_max REAL DEFAULT 0.5"); } catch (e) {}
  try { db.exec("ALTER TABLE rooms ADD COLUMN performance_fee REAL DEFAULT 10"); } catch (e) {}
  try { db.exec("ALTER TABLE rooms ADD COLUMN customer_share REAL DEFAULT 50"); } catch (e) {}
  try { db.exec("ALTER TABLE rooms ADD COLUMN fund_share REAL DEFAULT 40"); } catch (e) {}
  try { db.exec("ALTER TABLE rooms ADD COLUMN leader_earnings REAL DEFAULT 0"); } catch (e) {}

  try { db.exec("ALTER TABLE users ADD COLUMN frozen_balance REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN user_level TEXT DEFAULT 'L0'"); } catch (e) {}
  try { db.exec("ALTER TABLE follows ADD COLUMN stop_loss REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE follows ADD COLUMN stop_triggered INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE follows ADD COLUMN equity REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE follows ADD COLUMN ended_at TEXT"); } catch (e) {}
  try { db.exec("INSERT INTO platform_pool (id, balance) SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM platform_pool WHERE id = 1)"); } catch (e) {}
  try { db.exec("ALTER TABLE quotes ADD COLUMN api_id TEXT"); } catch (e) {}
  // ensure users.avatar column exists (existing DBs)
  try { db.exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''"); } catch (e) { /* already exists */ }

  const adminCount = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
  if (adminCount === 0) {
    db.prepare('INSERT INTO admins (username, password_hash, role) VALUES (?,?,?)')
      .run('admin', bcrypt.hashSync('Admin@123456', 10), 'superadmin');
  }

  const rateCount = db.prepare('SELECT COUNT(*) c FROM commission_rates').get().c;
  if (rateCount === 0) {
    const st = db.prepare('INSERT OR REPLACE INTO commission_rates (level, rate) VALUES (?,?)');
    st.run(1, 20); st.run(2, 12); st.run(3, 8);
  }

  seedUsers();
  seedRooms();
  seedProjects();
  seedTransactions();
  seedKyc();
  seedCommissions();
  seedContent();
  seedQuotes();
}

function seedUsers() {
  const c = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (c > 0) return;
  const ins = db.prepare(`INSERT INTO users (uid,name,phone,email,password,balance,total_assets,available,total_income,referral_code,referrer_id,level,status,kyc_status,is_verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const users = [
    ['1086626','Alex Mercer','+65 8123 4567','alex.mercer@gmail.com','',124500,124500,45200.50,32840.25,'ET-ALEX',null,3,'active','verified',1],
    ['1086627','陈伟强','+86 138 0013 8000','chenweiqiang@qq.com','',88000,88000,32000,15600,'ET-CWQ',1,2,'active','verified',1],
    ['1086628','李思思','+86 139 1234 5678','lisi@163.com','',45200,45200,15800,6800,'ET-LSS',1,2,'active','pending',0],
    ['1086629','张明远','+86 137 5555 6666','zmy@126.com','',23000,23000,9000,1200,'ET-ZMY',2,1,'active','unverified',0],
    ['1086630','王芳','+65 9876 5432','wangfang@gmail.com','',156000,156000,78000,45200,'ET-WF',1,3,'active','verified',1],
    ['1086631','刘志强','+86 186 0000 1111','liuzq@foxmail.com','',6700,6700,2100,350,'ET-LZQ',3,1,'frozen','unverified',0],
    ['1086632','赵雨欣','+86 135 2222 3333','zhaoyx@qq.com','',91200,91200,40500,18900,'ET-ZYX',2,2,'active','verified',1],
    ['1086633','孙浩','+86 188 4444 5555','sunhao@gmail.com','',33000,33000,12000,2300,'ET-SH',4,1,'active','pending',0],
  ];
  users.forEach(u => ins.run(...u));
}

function seedRooms() {
  const c = db.prepare('SELECT COUNT(*) c FROM rooms').get().c;
  if (c > 0) return;
  const ins = db.prepare(`INSERT INTO rooms (id,name,english_name,avatar,tags,total_profit,yield_rate,max_drawdown,running_days,followers_count,total_aum,win_rate,risk_level,description,sparkline,monthly_return,avg_daily_return,max_profit_single,max_loss_single,avg_profit,avg_loss,lots,win_trades,loss_trades,asset_distribution,category,is_hot,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const rooms = [
    ['alpha-quant','AlphaQuant Fund','Alpha Quant Fund','https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80','量化套利,机构级',28450,19.8,-3.1,420,2450,'$12.8M',81.2,'稳健型','华尔街自营团队开发的全自动做市与期现套利策略，低相关性、跨周期全天候资产配置。','[25,40,50,62,70,78,85,92,105,120]',4.2,0.18,15.6,310,120.5,-38.2,2.0,680,157,'[{"name":"BTC/USD","percentage":40,"color":"#004ac6"},{"name":"EUR/USD","percentage":35,"color":"#2b6954"},{"name":"XAU/USD","percentage":25,"color":"#b45309"}]','forex',1,1],
    ['peach-island','桃花岛上有桃花','Peach Blossom Island','https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80','专业交易员,稳健增长',14520.5,12.4,-4.2,342,1245,'$5.2M',72.7,'稳健型','专注于外汇直盘与黄金中短线波段交易，依托量化模型结合人工干预。追求稳健收益，严格风控，单笔最大亏损控制在2%以内。适合偏好长期稳定复利的投资者。','[20,35,28,45,60,52,70,65,85,95]',3.5,0.15,12.4,450,85.2,-42.1,0.5,342,128,'[{"name":"EUR/USD","percentage":45,"color":"#004ac6"},{"name":"XAU/USD","percentage":30,"color":"#2b6954"},{"name":"GBP/JPY","percentage":20,"color":"#b45309"},{"name":"其他","percentage":5,"color":"#93c5fd"}]','forex',1,2],
    ['quantum-edge','QuantumEdge','Quantum Edge Capital','https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80','量化交易,高频',8930.2,8.9,-2.1,180,892,'$3.4M',78.4,'量化高频','采用多因子高频套利策略，基于微秒级订单簿流分析与统计套利，日内平仓不持夜仓。回撤极低，适合防御型量化资本。','[30,42,38,55,68,62,75,82,88,92]',2.8,0.12,9.8,220,52.4,-18.5,1.2,512,141,'[{"name":"BTC/USDT","percentage":50,"color":"#004ac6"},{"name":"ETH/USDT","percentage":35,"color":"#2b6954"},{"name":"SOL/USDT","percentage":15,"color":"#b45309"}]','crypto',0,3],
    ['steady-growth','SteadyGrowth_99','Steady Growth 99','https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80','保守型',-1240,-3.4,-8.5,45,312,'$850K',54.2,'保守型','宏观对冲与价值债券轮动模型，近期受降息预期调整经历短期回撤，目前已启动二级防守风控。','[80,75,78,65,55,62,50,42,45,38]',-1.2,-0.05,4.5,680,45.0,-85.0,0.3,110,93,'[{"name":"USD/JPY","percentage":40,"color":"#004ac6"},{"name":"US10Y","percentage":35,"color":"#2b6954"},{"name":"XAG/USD","percentage":25,"color":"#b45309"}]','forex',0,4],
  ];
  rooms.forEach(r => ins.run(...r));
}

function seedProjects() {
  const c = db.prepare('SELECT COUNT(*) c FROM projects').get().c;
  if (c > 0) return;
  const ins = db.prepare(`INSERT INTO projects (id,title,subtitle,image,progress,estimated_yield,target_amount,min_investment,exit_route,team,category,raised_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const projects = [
    ['coffee-chain','精品咖啡连锁','城市扩张计划。','https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=400&auto=format&fit=crop&q=80',75,12.5,'50万',1000,'回购（36个月）','前星巴克高管','餐饮消费','37.5万'],
    ['tech-retail','科技零售体验店','旗舰AI硬件中心。','https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=400&auto=format&fit=crop&q=80',42,18.0,'120万',5000,'IPO途径','硅谷资深人士','智能硬件','50.4万'],
    ['vertical-farm','城市垂直农场','可持续城市农业。','https://images.unsplash.com/photo-1530836369250-ef72a3f5cda8?w=400&auto=format&fit=crop&q=80',89,14.2,'80万',2500,'收购目标（48个月）','农业科技专家','绿色科技','71.2万'],
    ['ev-supercharge','新能源超充站','核心商圈快充基础设施。','https://images.unsplash.com/photo-1593941707882-a5bba14938c7?w=400&auto=format&fit=crop&q=80',62,15.8,'200万',10000,'股息+回购（24个月）','前车企核心工程专家','新能源','124万'],
  ];
  projects.forEach(p => ins.run(...p));
}

function seedTransactions() {
  const c = db.prepare('SELECT COUNT(*) c FROM transactions').get().c;
  if (c > 0) return;
  const ins = db.prepare(`INSERT INTO transactions (txn_id,user_id,user_name,type,amount,network,address,title,subtitle,status,date,time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const txns = [
    ['TXN-20260831001',2,'陈伟强','deposit',5000,'USDT-TRC20','TXr9xPkLq3vB7mN2eYzF8cAbCdEfGhIjKlMnOpQ','USDT Deposit (TRC20)','充值待确认', 'pending', '2026-08-31','10:24'],
    ['TXN-20260831002',3,'李思思','deposit',2500,'USDT-ERC20','0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063','USDT Deposit (ERC20)','充值待确认', 'pending', '2026-08-31','11:02'],
    ['TXN-20260831003',4,'张明远','withdraw',1200,'USDT-TRC20','TXr9xPkLq3vB7mN2eYzF8cAbCdEfGhIjKlMnOpQ','Wire Transfer to ...','提现待审核', 'pending', '2026-08-31','09:15'],
    ['TXN-20260830004',5,'王芳','deposit',10000,'Bank ACH','','Bank Deposit (ACH)','充值成功到主账户', 'approved', '2026-08-30','14:30'],
    ['TXN-20260830005',2,'陈伟强','withdraw',800,'USDT-TRC20','TXr9xPkLq3vB7mN2eYzF8cAbCdEfGhIjKlMnOpQ','USDT Withdraw','提现已到账', 'approved', '2026-08-30','16:40'],
    ['TXN-20260829006',6,'刘志强','deposit',3000,'USDT-BSC','0x9A6dC0E1f2B3c4D5e6F7a8B9c0D1e2F3a4B5c6D7','USDT Deposit (BSC)','充值待确认', 'pending', '2026-08-29','20:11'],
    ['TXN-20260828007',7,'赵雨欣','withdraw',2000,'ETH-ERC20','0x7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7','ETH Withdraw','提现待审核', 'pending', '2026-08-28','13:55'],
    ['TXN-20260827008',8,'孙浩','deposit',1500,'USDT-TRC20','TXr9xPkLq3vB7mN2eYzF8cAbCdEfGhIjKlMnOpQ','USDT Deposit (TRC20)','充值成功到主账户', 'approved', '2026-08-27','15:20'],
    ['TXN-20260825009',1,'Alex Mercer','deposit',20000,'Bank ACH','','Bank Deposit (ACH)','充值成功到主账户', 'approved', '2026-08-25','10:00'],
    ['TXN-20260824010',1,'Alex Mercer','withdraw',5000,'USDT-TRC20','TXr9xPkLq3vB7mN2eYzF8cAbCdEfGhIjKlMnOpQ','USDT Withdraw','提现已到账', 'approved', '2026-08-24','18:30'],
  ];
  txns.forEach(t => ins.run(...t));
}

function seedKyc() {
  const c = db.prepare('SELECT COUNT(*) c FROM kyc').get().c;
  if (c > 0) return;
  const ins = db.prepare(`INSERT INTO kyc (user_id,user_name,kyc_type,id_number,real_name,front_image,back_image,handheld_image,status) VALUES (?,?,?,?,?,?,?,?,?)`);
  const kycs = [
    [3,'李思思','身份证','110101199502123456','李思思','https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400&auto=format&fit=crop&q=80','https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400&auto=format&fit=crop&q=80','https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400&auto=format&fit=crop&q=80','pending'],
    [8,'孙浩','护照','E76543210','SUN HAO','https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80','https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80','https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80','pending'],
  ];
  kycs.forEach(k => ins.run(...k));
}


function seedQuotes() {
  const c = db.prepare('SELECT COUNT(*) c FROM quotes').get().c;
  if (c > 0) return;
  const ins = db.prepare('INSERT OR REPLACE INTO quotes (symbol,name,price,ask_price,change_percent,category) VALUES (?,?,?,?,?,?)');
  const qs = [
    ['XAUUSD','现货黄金',2345.60,2346.10,0.42,'precious'],
    ['XAGUSD','现货白银',28.45,28.50,-1.12,'precious'],
    ['XPTUSD','铂金',985.20,986.50,0.85,'precious'],
    ['BTC/USDT','比特币',64820.50,64825.00,2.15,'crypto'],
    ['ETH/USDT','以太坊',3450.20,3452.00,1.80,'crypto'],
    ['SOL/USDT','Solana',154.30,154.50,5.42,'crypto'],
    ['UKOIL','布伦特原油',84.60,84.65,-0.45,'oil'],
    ['USOIL','WTI原油',80.25,80.30,-0.62,'oil'],
  ];
  qs.forEach(q => ins.run(...q));
  const apiSt = db.prepare("UPDATE quotes SET api_id = ? WHERE symbol = ?");
  apiSt.run('bitcoin', 'BTC/USDT'); apiSt.run('ethereum', 'ETH/USDT'); apiSt.run('solana', 'SOL/USDT');
}

function seedCommissions() {
  const c = db.prepare('SELECT COUNT(*) c FROM commissions').get().c;
  if (c > 0) return;
  const ins = db.prepare(`INSERT INTO commissions (user_id,user_name,level,amount,rate,order_id) VALUES (?,?,?,?,?,?)`);
  const comms = [
    [1,'Alex Mercer',1,5000,0.20,'ORD-202608-001'],
    [2,'陈伟强',1,2500,0.20,'ORD-202608-002'],
    [3,'李思思',2,800,0.12,'ORD-202608-003'],
    [5,'王芳',1,8800,0.20,'ORD-202608-004'],
    [7,'赵雨欣',2,1500,0.12,'ORD-202608-005'],
    [8,'孙浩',3,420,0.08,'ORD-202608-006'],
  ];
  comms.forEach(c2 => ins.run(...c2));
}

function seedContent() {
  const c = db.prepare('SELECT COUNT(*) c FROM content_settings').get().c;
  if (c > 0) return;
  const ins = db.prepare('INSERT OR REPLACE INTO content_settings (key,value,type) VALUES (?,?,?)');
  const items = [
    ['app_name','EliteTrade','text'],
    ['app_slogan','智能量化交易与实体众筹投资平台','text'],
    ['home_banner_title','专业量化跟单，让资产稳健增值','text'],
    ['home_banner_subtitle','AI量化策略 + 实体众筹，一站式全球资产配置','text'],
    ['home_banner_image','https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop&q=80','image'],
    ['hot_section_title','热门跟单专区','text'],
    ['hot_section_tag','热门','text'],
    ['crowdfunding_title','实体众筹','text'],
    ['crowdfunding_subtitle','共同投资经过严格审查的高收益实体企业。利用机构级的碎片化所有权。','text'],
    ['referral_title','邀请好友，共享收益','text'],
    ['referral_desc','邀请好友，可享高达30%的好友交易手续费返佣。','text'],
    ['deposit_notice','充值请务必使用本人实名钱包地址，到账后自动入账。','text'],
    ['withdraw_notice','提现申请将在审核通过后 24 小时内到账。','text'],
    ['customer_service','联系在线客服获取帮助','text'],
  ];
  items.forEach(i => ins.run(...i));
}