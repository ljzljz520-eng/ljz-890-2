/**
 * 数据层：基于 sql.js（SQLite WASM）的轻量封装
 * 提供类似 better-sqlite3 的同步 API，写操作后自动持久化到 data/memorial.db
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { randomSalt, hashPassword } = require('./lib/auth');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'memorial.db');

let db = null;
let saveTimer = null;

function saveNow() {
  if (!db) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

function bindParams(stmt, params) {
  if (!params || params.length === 0) return;
  // 支持 run([v1,v2,...]) 数组形式
  if (params.length === 1 && Array.isArray(params[0])) {
    stmt.bind(params[0].map((v) => (v === undefined ? null : v)));
    return;
  }
  if (params.length === 1 && params[0] && typeof params[0] === 'object') {
    const obj = {};
    for (const [k, v] of Object.entries(params[0])) {
      obj[/^[@:$]/.test(k) ? k : '@' + k] = v === undefined ? null : v;
    }
    stmt.bind(obj);
  } else {
    stmt.bind(params.map((v) => (v === undefined ? null : v)));
  }
}

class Stmt {
  constructor(sql) { this.sql = sql; }
  run(...params) {
    const stmt = db.prepare(this.sql);
    try { bindParams(stmt, params); stmt.step(); }
    finally { stmt.free(); }
    const changes = db.getRowsModified();
    const r = db.exec('SELECT last_insert_rowid() AS id');
    scheduleSave();
    return { changes, lastInsertRowid: r.length ? r[0].values[0][0] : 0 };
  }
  get(...params) {
    const stmt = db.prepare(this.sql);
    try {
      bindParams(stmt, params);
      return stmt.step() ? stmt.getAsObject() : undefined;
    } finally { stmt.free(); }
  }
  all(...params) {
    const stmt = db.prepare(this.sql);
    const rows = [];
    try {
      bindParams(stmt, params);
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally { stmt.free(); }
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS martyrs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gender TEXT DEFAULT '',
  birth_date TEXT DEFAULT '',
  death_date TEXT DEFAULT '',
  memorial_date TEXT DEFAULT '',
  birthplace TEXT DEFAULT '',
  title TEXT DEFAULT '',
  biography TEXT DEFAULT '',
  deeds TEXT DEFAULT '',
  portrait TEXT DEFAULT '',
  flowers INTEGER DEFAULT 0,
  candles INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  martyr_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  caption TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (martyr_id) REFERENCES martyrs(id)
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  martyr_id INTEGER,
  title TEXT NOT NULL,
  category TEXT DEFAULT '文献',
  content TEXT DEFAULT '',
  deleted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (martyr_id) REFERENCES martyrs(id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  martyr_id INTEGER,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  reviewed_at TEXT,
  FOREIGN KEY (martyr_id) REFERENCES martyrs(id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);
`;

const DEFAULT_SETTINGS = {
  site_name: '英烈纪念园',
  site_slogan: '铭记历史 · 缅怀先烈 · 珍爱和平',
  footer_copyright: '© 2026 英烈纪念园 版权所有',
  contact_phone: '010-00000000',
  contact_email: 'memorial@example.org',
  contact_address: '北京市西城区纪念路 1 号',
  icp: '京ICP备00000000号',
};

function seed() {
  // 默认管理员（首次启动后请立即登录后台修改密码）
  if (wrapper.prepare('SELECT COUNT(*) AS c FROM admins').get().c === 0) {
    const salt = randomSalt();
    wrapper.prepare('INSERT INTO admins (username, password_hash, salt) VALUES (?,?,?)')
      .run('admin', hashPassword('admin123456', salt), salt);
    console.log('已创建默认管理员账号 admin / admin123456 （请尽快登录后台修改）');
  }

  const insSetting = wrapper.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

  if (wrapper.prepare('SELECT COUNT(*) AS c FROM martyrs').get().c > 0) return;

  console.log('写入示例数据……');
  const insMartyr = wrapper.prepare(`INSERT INTO martyrs
    (name, gender, birth_date, death_date, memorial_date, birthplace, title, biography, deeds)
    VALUES (@name,@gender,@birth_date,@death_date,@memorial_date,@birthplace,@title,@biography,@deeds)`);

  const m1 = insMartyr.run({
    name: '李志强', gender: '男', birth_date: '1920-03-15', death_date: '1948-05-12',
    memorial_date: '每年 5 月 12 日（牺牲纪念日）、9 月 30 日（烈士纪念日）',
    birthplace: '山东省临沂市', title: '革命烈士 · 某部排长',
    biography: '李志强，1920 年 3 月生于山东省临沂市一个农民家庭。1941 年参加八路军，先后参加大小战斗数十次，屡立战功。\n1948 年 5 月 12 日，在解放家乡的战斗中，为掩护战友和群众安全转移，他毅然坚守阵地，壮烈牺牲，年仅 28 岁。',
    deeds: '1945 年秋，在反“扫荡”战斗中，他带领一个班阻击数倍于己的敌人，为大部队转移赢得宝贵时间，荣立一等功。\n1948 年 5 月，在最后的战斗中，他身负重伤仍坚持指挥，直至流尽最后一滴血。1950 年被追认为革命烈士。',
  }).lastInsertRowid;

  const m2 = insMartyr.run({
    name: '王秀英', gender: '女', birth_date: '1925-08-02', death_date: '1947-11-03',
    memorial_date: '每年 11 月 3 日（牺牲纪念日）、清明节',
    birthplace: '河北省保定市', title: '革命烈士 · 地下交通员',
    biography: '王秀英，1925 年 8 月生于河北省保定市。1943 年加入中国共产党，担任地下交通员，多次冒着生命危险传递情报、护送干部。\n1947 年 11 月 3 日，因叛徒出卖不幸被捕。面对敌人的严刑拷打，她坚贞不屈，严守党的秘密，英勇就义，年仅 22 岁。',
    deeds: '担任地下交通员期间，她先后传递重要情报百余份，护送党员干部数十人，从未出过差错。\n就义前，她高呼“中国共产党万岁”，表现了共产党人视死如归的英雄气概。',
  }).lastInsertRowid;

  const m3 = insMartyr.run({
    name: '张卫国', gender: '男', birth_date: '1930-01-20', death_date: '1951-04-22',
    memorial_date: '每年 4 月 22 日（牺牲纪念日）、10 月 25 日（抗美援朝纪念日）',
    birthplace: '四川省成都市', title: '革命烈士 · 中国人民志愿军战士',
    biography: '张卫国，1930 年 1 月生于四川省成都市。1950 年 10 月，他响应“抗美援朝、保家卫国”的号召，毅然报名参加中国人民志愿军，奔赴朝鲜战场。\n1951 年 4 月 22 日，在第五次战役中，为夺回被敌人占领的阵地，他抱起炸药包冲向敌群，与敌人同归于尽，年仅 21 岁。',
    deeds: '在朝鲜战场上，他作战勇敢，多次完成艰巨任务。\n牺牲后，志愿军总部为他追记特等功，授予“二级英雄”称号。他的英雄事迹在家乡广为传颂。',
  }).lastInsertRowid;

  const insDoc = wrapper.prepare('INSERT INTO documents (martyr_id, title, category, content) VALUES (?,?,?,?)');
  insDoc.run(m1, '李志强烈士家书（节录）', '家书',
    '亲爱的爹娘：\n儿在外一切安好，请勿挂念。如今国难当头，儿既已投身革命，便当以国家民族为重。自古忠孝难两全，待山河光复之日，儿再回家尽孝。\n儿 志强 叩上\n一九四七年冬');
  insDoc.run(m2, '王秀英烈士事迹调查报告', '档案',
    '……经走访当地群众及生前战友核实，王秀英同志自 1943 年参加工作以来，立场坚定，工作积极，多次出色完成组织交办的任务。被捕后，敌人施以酷刑，她始终坚贞不屈，未泄露任何组织秘密……');
  insDoc.run(m3, '张卫国烈士立功证明书', '档案',
    '兹证明张卫国同志在抗美援朝第五次战役中，英勇顽强，不怕牺牲，为战斗胜利作出重大贡献，特记特等功一次，并授予“二级英雄”称号。');

  const insMsg = wrapper.prepare(`INSERT INTO messages (martyr_id, author, content, status, reviewed_at) VALUES (?,?,?,'approved',datetime('now','localtime'))`);
  insMsg.run(m1, '市民 张先生', '英雄虽逝，浩气长存。我们永远怀念您！');
  insMsg.run(m2, '学生 李晓', '今天的幸福生活来之不易，我们一定好好学习，报效祖国。');
  insMsg.run(null, '网友 远方', '青山埋忠骨，史册载功勋。向所有为民族独立和人民解放献出生命的英烈致敬！');
}

async function init() {
  const SQL = await initSqlJs();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  seed();
  saveNow();
  console.log('数据库就绪：' + DB_FILE);
}

const wrapper = {
  init,
  prepare: (sql) => new Stmt(sql),
  exec: (sql) => { db.exec(sql); scheduleSave(); },
  transaction(fn) {
    return (...args) => {
      db.exec('BEGIN');
      try {
        const r = fn(...args);
        db.exec('COMMIT');
        scheduleSave();
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    };
  },
  saveNow,
  DB_FILE,
};

module.exports = wrapper;
