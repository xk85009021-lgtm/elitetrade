import bcrypt from 'bcryptjs';
import { db, initDb } from '../server/db.js';

initDb();

const businessTables = [
  'group_messages','group_members','groups','investments','yield_records','room_daily_yields',
  'follows','transactions','kyc','invite_rewards','team_rewards','commissions','notifications',
  'support_messages','support_threads','lead_trader_applications','password_reset_codes','user_sessions',
  'audit_logs','referral_rewards','price_history','quotes','projects','rooms','users'
];

const reset = db.transaction(() => {
  for (const table of businessTables) {
    try { db.prepare('DELETE FROM ' + table).run(); } catch (error) { console.warn('skip ' + table + ': ' + error.message); }
  }
  try { db.prepare("DELETE FROM sqlite_sequence WHERE name IN (" + businessTables.map(() => '?').join(',') + ")").run(...businessTables); } catch {}
  db.prepare("UPDATE content_settings SET value='盈透copy' WHERE key='app_name'").run();
  db.prepare("UPDATE content_settings SET value='' WHERE key IN ('app_logo','home_banner_image')").run();
  db.prepare("DELETE FROM content_settings WHERE key LIKE 'wallet_%'").run();
  if (process.env.ADMIN_RESET_PASSWORD) {
    db.prepare('UPDATE admins SET password_hash=? WHERE username=?').run(bcrypt.hashSync(process.env.ADMIN_RESET_PASSWORD, 10), process.env.ADMIN_USERNAME || 'admin');
  }
});

reset();
db.pragma('wal_checkpoint(TRUNCATE)');
console.log('运营数据已清空：用户、房间、项目、资金、KYC、跟单、通知、客服、审计和演示行情均已删除。');
console.log('管理员账号和管理配置保留。');
