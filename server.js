/** 英烈纪念园 · 烈士纪念资料站 */
const express = require('express');
const path = require('path');
const db = require('./db');
const { ensureTodayBackup } = require('./lib/backup');

const app = express();
const PORT = process.env.PORT || 3000;

// 简易 Cookie 解析
app.use((req, res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (raw) {
    raw.split(';').forEach((p) => {
      const i = p.indexOf('=');
      if (i > -1) req.cookies[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
  }
  next();
});

app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

db.init().then(() => {
  ensureTodayBackup(db); // 每日自动备份
  app.listen(PORT, () => {
    console.log('\n  英烈纪念园已启动');
    console.log(`  前台：http://localhost:${PORT}`);
    console.log(`  后台：http://localhost:${PORT}/admin\n`);
  });
  const shutdown = () => { db.saveNow(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}).catch((e) => {
  console.error('启动失败：', e);
  process.exit(1);
});
