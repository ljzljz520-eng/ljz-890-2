/**
 * 内容备份与恢复：
 * - 备份 = 全部数据表导出为 data.json + 上传图片目录副本，存放于 backups/backup-时间戳/
 * - 支持从服务器备份恢复、上传备份文件恢复；恢复前自动创建安全备份
 */
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
const TABLES = ['martyrs', 'photos', 'documents', 'messages', 'settings'];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dst, f));
  }
}

function dumpData(db) {
  const tables = {};
  for (const t of TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return { version: 1, created_at: new Date().toISOString(), tables };
}

function createBackup(db) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  // 同一秒内可能连续创建多个备份（如恢复前的安全备份），需保证 id 唯一
  let id = 'backup-' + stamp();
  let dir = path.join(BACKUP_DIR, id);
  for (let n = 1; fs.existsSync(dir); n++) {
    id = 'backup-' + stamp() + '-' + String(n).padStart(2, '0');
    dir = path.join(BACKUP_DIR, id);
  }
  fs.mkdirSync(dir, { recursive: true });
  const data = dumpData(db);
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
  copyDir(UPLOADS_DIR, path.join(dir, 'uploads'));
  return { id, created_at: data.created_at };
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((d) => /^backup-[\d-]+$/.test(d) && fs.existsSync(path.join(BACKUP_DIR, d, 'data.json')))
    .map((id) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, id, 'data.json'), 'utf8'));
        const counts = {};
        for (const [k, v] of Object.entries(data.tables || {})) counts[k] = v.length;
        return { id, created_at: data.created_at, counts };
      } catch {
        return { id, created_at: '', counts: {} };
      }
    })
    .sort()
    .reverse();
}

function insertRows(db, table, rows) {
  if (!rows || !rows.length) return;
  const cols = Object.keys(rows[0]);
  const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  for (const r of rows) stmt.run(cols.map((c) => r[c]));
}

function restoreData(db, data) {
  if (!data || typeof data !== 'object' || !data.tables) throw new Error('备份数据格式不正确');
  for (const t of TABLES) {
    if (data.tables[t] && !Array.isArray(data.tables[t])) throw new Error('备份数据格式不正确');
  }
  // 外键约束：先删子表再删主表；插入时先主表后子表
  const DELETE_ORDER = ['photos', 'documents', 'messages', 'martyrs', 'settings'];
  const INSERT_ORDER = ['settings', 'martyrs', 'photos', 'documents', 'messages'];
  db.transaction(() => {
    for (const t of DELETE_ORDER) db.prepare(`DELETE FROM ${t}`).run();
    for (const t of INSERT_ORDER) insertRows(db, t, data.tables[t] || []);
  })();
}

function restoreFromId(db, id) {
  if (!/^backup-[\d-]+$/.test(id)) throw new Error('备份名称不合法');
  const dir = path.join(BACKUP_DIR, id);
  const file = path.join(dir, 'data.json');
  if (!fs.existsSync(file)) throw new Error('备份不存在');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  restoreData(db, data);
  const up = path.join(dir, 'uploads');
  if (fs.existsSync(up)) copyDir(up, UPLOADS_DIR);
}

function removeBackup(id) {
  if (!/^backup-[\d-]+$/.test(id)) throw new Error('备份名称不合法');
  const dir = path.join(BACKUP_DIR, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/** 每天首次启动自动备份一次 */
function ensureTodayBackup(db) {
  const today = 'backup-' + stamp().slice(0, 8);
  if (!listBackups().some((b) => b.id.startsWith(today))) {
    try {
      const b = createBackup(db);
      console.log('已创建每日自动备份：' + b.id);
    } catch (e) {
      console.error('自动备份失败：', e.message);
    }
  }
}

module.exports = { BACKUP_DIR, UPLOADS_DIR, createBackup, listBackups, restoreData, restoreFromId, removeBackup, ensureTodayBackup };
