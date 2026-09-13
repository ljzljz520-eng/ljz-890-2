/** 后台管理接口（除登录外均需鉴权） */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { verifyPassword, hashPassword, randomSalt, createSession, destroySession, authMiddleware } = require('../lib/auth');
const backup = require('../lib/backup');

const router = express.Router();

const UPLOADS = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|gif|webp|bmp)$/.test(file.mimetype)) return cb(new Error('仅支持 JPG/PNG/GIF/WEBP 图片'));
    cb(null, true);
  },
});

const SETTING_KEYS = ['site_name', 'site_slogan', 'footer_copyright', 'contact_phone', 'contact_email', 'contact_address', 'icp'];
const RECYCLE_TABLES = { martyrs: 'martyrs', photos: 'photos', documents: 'documents' };

/* ---------- 登录 / 退出 / 改密 ---------- */
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const row = db.prepare('SELECT * FROM admins WHERE username=?').get(String(username || ''));
  if (!row || !verifyPassword(String(password || ''), row.salt, row.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = createSession(row.username);
  res.setHeader('Set-Cookie', `memorial_token=${token}; HttpOnly; Path=/; Max-Age=${12 * 3600}; SameSite=Lax`);
  res.json({ ok: true, username: row.username });
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies && req.cookies.memorial_token);
  res.setHeader('Set-Cookie', 'memorial_token=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req, res) => res.json({ username: req.adminUser }));

router.post('/password', authMiddleware, (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 8) return res.status(400).json({ error: '新密码长度至少 8 位' });
  const row = db.prepare('SELECT * FROM admins WHERE username=?').get(req.adminUser);
  if (!row || !verifyPassword(String(old_password || ''), row.salt, row.password_hash)) {
    return res.status(400).json({ error: '原密码错误' });
  }
  const salt = randomSalt();
  db.prepare('UPDATE admins SET password_hash=?, salt=? WHERE id=?').run(hashPassword(new_password, salt), salt, row.id);
  res.json({ ok: true });
});

/* ---------- 以下接口均需登录 ---------- */
router.use(authMiddleware);

router.get('/overview', (req, res) => {
  res.json({
    martyrs: db.prepare('SELECT COUNT(*) AS c FROM martyrs WHERE deleted=0').get().c,
    photos: db.prepare('SELECT COUNT(*) AS c FROM photos WHERE deleted=0').get().c,
    documents: db.prepare('SELECT COUNT(*) AS c FROM documents WHERE deleted=0').get().c,
    pending: db.prepare("SELECT COUNT(*) AS c FROM messages WHERE status='pending'").get().c,
    approved: db.prepare("SELECT COUNT(*) AS c FROM messages WHERE status='approved'").get().c,
    recycled: db.prepare('SELECT (SELECT COUNT(*) FROM martyrs WHERE deleted=1)+(SELECT COUNT(*) FROM photos WHERE deleted=1)+(SELECT COUNT(*) FROM documents WHERE deleted=1) AS c').get().c,
  });
});

/* ---------- 人物管理 ---------- */
router.get('/martyrs', (req, res) => {
  res.json(db.prepare('SELECT * FROM martyrs WHERE deleted=0 ORDER BY id DESC').all());
});

function martyrFields(b) {
  return {
    name: String(b.name || '').trim(),
    gender: String(b.gender || '').slice(0, 10),
    birth_date: String(b.birth_date || '').slice(0, 40),
    death_date: String(b.death_date || '').slice(0, 40),
    memorial_date: String(b.memorial_date || '').slice(0, 200),
    birthplace: String(b.birthplace || '').slice(0, 100),
    title: String(b.title || '').slice(0, 100),
    biography: String(b.biography || ''),
    deeds: String(b.deeds || ''),
    portrait: String(b.portrait || '').slice(0, 300),
  };
}

router.post('/martyrs', (req, res) => {
  const f = martyrFields(req.body || {});
  if (!f.name) return res.status(400).json({ error: '姓名不能为空' });
  const r = db.prepare(`INSERT INTO martyrs (name,gender,birth_date,death_date,memorial_date,birthplace,title,biography,deeds,portrait)
    VALUES (@name,@gender,@birth_date,@death_date,@memorial_date,@birthplace,@title,@biography,@deeds,@portrait)`).run(f);
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.put('/martyrs/:id', (req, res) => {
  const m = db.prepare('SELECT id FROM martyrs WHERE id=? AND deleted=0').get(Number(req.params.id) || 0);
  if (!m) return res.status(404).json({ error: '记录不存在或已删除' });
  const f = martyrFields(req.body || {});
  if (!f.name) return res.status(400).json({ error: '姓名不能为空' });
  db.prepare(`UPDATE martyrs SET name=@name,gender=@gender,birth_date=@birth_date,death_date=@death_date,
    memorial_date=@memorial_date,birthplace=@birthplace,title=@title,biography=@biography,deeds=@deeds,portrait=@portrait,
    updated_at=datetime('now','localtime') WHERE id=@id`).run({ ...f, id: m.id });
  res.json({ ok: true });
});

router.delete('/martyrs/:id', (req, res) => {
  db.prepare('UPDATE martyrs SET deleted=1 WHERE id=?').run(Number(req.params.id) || 0);
  res.json({ ok: true });
});

/* ---------- 照片管理 ---------- */
router.get('/photos', (req, res) => {
  const base = `SELECT p.*, m.name AS martyr_name FROM photos p LEFT JOIN martyrs m ON p.martyr_id=m.id WHERE p.deleted=0`;
  if (req.query.martyr_id) {
    return res.json(db.prepare(base + ' AND p.martyr_id=? ORDER BY p.sort_order, p.id').all(Number(req.query.martyr_id) || 0));
  }
  res.json(db.prepare(base + ' ORDER BY p.id DESC').all());
});

router.post('/photos', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '上传失败' });
    const martyrId = Number(req.body.martyr_id) || 0;
    if (!db.prepare('SELECT id FROM martyrs WHERE id=? AND deleted=0').get(martyrId)) {
      if (req.file) fs.unlink(path.join(UPLOADS, req.file.filename), () => {});
      return res.status(400).json({ error: '请选择所属人物' });
    }
    if (!req.file) return res.status(400).json({ error: '请选择照片文件' });
    const caption = String(req.body.caption || '').slice(0, 100);
    const filename = '/uploads/' + req.file.filename;
    const r = db.prepare('INSERT INTO photos (martyr_id, filename, caption) VALUES (?,?,?)').run(martyrId, filename, caption);
    res.json({ ok: true, id: r.lastInsertRowid, filename });
  });
});

router.put('/photos/:id', (req, res) => {
  const p = db.prepare('SELECT id FROM photos WHERE id=? AND deleted=0').get(Number(req.params.id) || 0);
  if (!p) return res.status(404).json({ error: '照片不存在' });
  const caption = String((req.body && req.body.caption) || '').slice(0, 100);
  const sort = Number((req.body && req.body.sort_order) || 0) || 0;
  db.prepare('UPDATE photos SET caption=?, sort_order=? WHERE id=?').run(caption, sort, p.id);
  res.json({ ok: true });
});

router.delete('/photos/:id', (req, res) => {
  db.prepare('UPDATE photos SET deleted=1 WHERE id=?').run(Number(req.params.id) || 0);
  res.json({ ok: true });
});

/* ---------- 文献管理 ---------- */
router.get('/documents', (req, res) => {
  res.json(db.prepare(`SELECT d.*, m.name AS martyr_name FROM documents d
    LEFT JOIN martyrs m ON d.martyr_id=m.id WHERE d.deleted=0 ORDER BY d.id DESC`).all());
});

function docFields(b) {
  return {
    martyr_id: b.martyr_id ? Number(b.martyr_id) : null,
    title: String(b.title || '').trim().slice(0, 200),
    category: String(b.category || '文献').slice(0, 30),
    content: String(b.content || ''),
  };
}

router.post('/documents', (req, res) => {
  const f = docFields(req.body || {});
  if (!f.title) return res.status(400).json({ error: '标题不能为空' });
  const r = db.prepare('INSERT INTO documents (martyr_id, title, category, content) VALUES (@martyr_id,@title,@category,@content)').run(f);
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.put('/documents/:id', (req, res) => {
  const d = db.prepare('SELECT id FROM documents WHERE id=? AND deleted=0').get(Number(req.params.id) || 0);
  if (!d) return res.status(404).json({ error: '文献不存在' });
  const f = docFields(req.body || {});
  if (!f.title) return res.status(400).json({ error: '标题不能为空' });
  db.prepare('UPDATE documents SET martyr_id=@martyr_id, title=@title, category=@category, content=@content WHERE id=@id')
    .run({ ...f, id: d.id });
  res.json({ ok: true });
});

router.delete('/documents/:id', (req, res) => {
  db.prepare('UPDATE documents SET deleted=1 WHERE id=?').run(Number(req.params.id) || 0);
  res.json({ ok: true });
});

/* ---------- 留言审核 ---------- */
router.get('/messages', (req, res) => {
  const status = String(req.query.status || 'pending');
  const base = `SELECT g.*, m.name AS martyr_name FROM messages g LEFT JOIN martyrs m ON g.martyr_id=m.id`;
  if (status === 'all') return res.json(db.prepare(base + ' ORDER BY g.id DESC LIMIT 500').all());
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: '参数错误' });
  res.json(db.prepare(base + ' WHERE g.status=? ORDER BY g.id DESC LIMIT 500').all(status));
});

router.post('/messages/:id/review', (req, res) => {
  const action = req.body && req.body.action;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: '参数错误' });
  const r = db.prepare(`UPDATE messages SET status=?, reviewed_at=datetime('now','localtime') WHERE id=?`)
    .run(action === 'approve' ? 'approved' : 'rejected', Number(req.params.id) || 0);
  if (!r.changes) return res.status(404).json({ error: '留言不存在' });
  res.json({ ok: true });
});

router.delete('/messages/:id', (req, res) => {
  db.prepare('DELETE FROM messages WHERE id=?').run(Number(req.params.id) || 0);
  res.json({ ok: true });
});

/* ---------- 站点设置 ---------- */
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  db.transaction(() => {
    for (const k of SETTING_KEYS) if (k in body) stmt.run(k, String(body[k] ?? '').slice(0, 500));
  })();
  res.json({ ok: true });
});

/* ---------- 回收站（误删保护） ---------- */
router.get('/recycle', (req, res) => {
  res.json({
    martyrs: db.prepare('SELECT id, name, updated_at FROM martyrs WHERE deleted=1 ORDER BY id DESC').all(),
    photos: db.prepare(`SELECT p.id, p.filename, p.caption, m.name AS martyr_name FROM photos p
      LEFT JOIN martyrs m ON p.martyr_id=m.id WHERE p.deleted=1 ORDER BY p.id DESC`).all(),
    documents: db.prepare(`SELECT d.id, d.title, m.name AS martyr_name FROM documents d
      LEFT JOIN martyrs m ON d.martyr_id=m.id WHERE d.deleted=1 ORDER BY d.id DESC`).all(),
  });
});

router.post('/recycle/:type/:id/restore', (req, res) => {
  const t = RECYCLE_TABLES[req.params.type];
  if (!t) return res.status(400).json({ error: '类型错误' });
  db.prepare(`UPDATE ${t} SET deleted=0 WHERE id=?`).run(Number(req.params.id) || 0);
  res.json({ ok: true });
});

router.delete('/recycle/:type/:id', (req, res) => {
  const t = RECYCLE_TABLES[req.params.type];
  if (!t) return res.status(400).json({ error: '类型错误' });
  db.prepare(`DELETE FROM ${t} WHERE id=? AND deleted=1`).run(Number(req.params.id) || 0);
  res.json({ ok: true });
});

/* ---------- 数据备份 ---------- */
router.get('/backups', (req, res) => res.json(backup.listBackups()));

router.post('/backups', (req, res) => {
  try {
    const b = backup.createBackup(db);
    res.json({ ok: true, ...b });
  } catch (e) {
    res.status(500).json({ error: '备份失败：' + e.message });
  }
});

router.get('/backups/:id/download', (req, res) => {
  if (!/^backup-[\d-]+$/.test(req.params.id)) return res.status(400).json({ error: '参数错误' });
  const file = path.join(backup.BACKUP_DIR, req.params.id, 'data.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: '备份不存在' });
  res.download(file, req.params.id + '.json');
});

router.post('/backups/:id/restore', (req, res) => {
  try {
    const safety = backup.createBackup(db); // 恢复前自动安全备份
    backup.restoreFromId(db, req.params.id);
    res.json({ ok: true, safety: safety.id });
  } catch (e) {
    res.status(400).json({ error: '恢复失败：' + e.message });
  }
});

router.post('/backups/restore-data', (req, res) => {
  try {
    const safety = backup.createBackup(db);
    backup.restoreData(db, req.body);
    res.json({ ok: true, safety: safety.id });
  } catch (e) {
    res.status(400).json({ error: '恢复失败：' + e.message });
  }
});

router.delete('/backups/:id', (req, res) => {
  try {
    backup.removeBackup(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---------- 肖像上传 ---------- */
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '上传失败' });
    if (!req.file) return res.status(400).json({ error: '未选择文件' });
    res.json({ ok: true, filename: '/uploads/' + req.file.filename });
  });
});

module.exports = router;
