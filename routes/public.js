/** 前台公开接口 */
const express = require('express');
const db = require('../db');

const router = express.Router();

const PUBLIC_SETTING_KEYS = ['site_name', 'site_slogan', 'footer_copyright', 'contact_phone', 'contact_email', 'contact_address', 'icp'];

router.get('/site', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = {};
  PUBLIC_SETTING_KEYS.forEach((k) => (out[k] = map[k] || ''));
  res.json(out);
});

router.get('/stats', (req, res) => {
  res.json({
    martyrs: db.prepare('SELECT COUNT(*) AS c FROM martyrs WHERE deleted=0').get().c,
    documents: db.prepare('SELECT COUNT(*) AS c FROM documents WHERE deleted=0').get().c,
    messages: db.prepare("SELECT COUNT(*) AS c FROM messages WHERE status='approved'").get().c,
    flowers: db.prepare('SELECT COALESCE(SUM(flowers),0) AS s FROM martyrs WHERE deleted=0').get().s,
    candles: db.prepare('SELECT COALESCE(SUM(candles),0) AS s FROM martyrs WHERE deleted=0').get().s,
  });
});

router.get('/martyrs', (req, res) => {
  const q = String(req.query.q || '').trim();
  const cols = 'id,name,title,gender,birth_date,death_date,memorial_date,birthplace,portrait,flowers,candles';
  if (q) {
    const like = `%${q}%`;
    return res.json(db.prepare(`SELECT ${cols} FROM martyrs WHERE deleted=0 AND (name LIKE ? OR birthplace LIKE ? OR title LIKE ?) ORDER BY id DESC`).all(like, like, like));
  }
  res.json(db.prepare(`SELECT ${cols} FROM martyrs WHERE deleted=0 ORDER BY id DESC`).all());
});

router.get('/martyrs/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM martyrs WHERE id=? AND deleted=0').get(Number(req.params.id) || 0);
  if (!m) return res.status(404).json({ error: '未找到该人物' });
  const photos = db.prepare('SELECT id, filename, caption FROM photos WHERE martyr_id=? AND deleted=0 ORDER BY sort_order, id').all(m.id);
  const documents = db.prepare('SELECT id, title, category, content, created_at FROM documents WHERE martyr_id=? AND deleted=0 ORDER BY id DESC').all(m.id);
  res.json({ ...m, photos, documents });
});

router.post('/martyrs/:id/tribute', (req, res) => {
  const id = Number(req.params.id) || 0;
  const m = db.prepare('SELECT id FROM martyrs WHERE id=? AND deleted=0').get(id);
  if (!m) return res.status(404).json({ error: '未找到该人物' });
  const type = req.body && req.body.type;
  if (type === 'flower') db.prepare('UPDATE martyrs SET flowers=flowers+1 WHERE id=?').run(id);
  else if (type === 'candle') db.prepare('UPDATE martyrs SET candles=candles+1 WHERE id=?').run(id);
  else return res.status(400).json({ error: '参数错误' });
  res.json(db.prepare('SELECT flowers, candles FROM martyrs WHERE id=?').get(id));
});

router.get('/documents', (req, res) => {
  res.json(db.prepare(`
    SELECT d.id, d.title, d.category, d.content, d.created_at, d.martyr_id, m.name AS martyr_name
    FROM documents d LEFT JOIN martyrs m ON d.martyr_id = m.id
    WHERE d.deleted=0 ORDER BY d.id DESC`).all());
});

router.get('/messages', (req, res) => {
  const base = `SELECT g.id, g.author, g.content, g.created_at, g.martyr_id, m.name AS martyr_name
    FROM messages g LEFT JOIN martyrs m ON g.martyr_id = m.id WHERE g.status='approved'`;
  if (req.query.martyr_id) {
    return res.json(db.prepare(base + ' AND g.martyr_id=? ORDER BY g.id DESC LIMIT 100').all(Number(req.query.martyr_id) || 0));
  }
  res.json(db.prepare(base + ' ORDER BY g.id DESC LIMIT 100').all());
});

router.post('/messages', (req, res) => {
  const author = String((req.body && req.body.author) || '').trim().slice(0, 30);
  const content = String((req.body && req.body.content) || '').trim().slice(0, 500);
  let martyrId = req.body && req.body.martyr_id ? Number(req.body.martyr_id) : null;
  if (!author) return res.status(400).json({ error: '请填写您的姓名或称谓' });
  if (!content) return res.status(400).json({ error: '请填写寄语内容' });
  if (martyrId && !db.prepare('SELECT id FROM martyrs WHERE id=? AND deleted=0').get(martyrId)) martyrId = null;
  db.prepare('INSERT INTO messages (martyr_id, author, content) VALUES (?,?,?)').run(martyrId, author, content);
  res.json({ ok: true, message: '寄语已提交，经管理员审核后将公开展示。' });
});

module.exports = router;
