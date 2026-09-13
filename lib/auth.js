/**
 * 管理员鉴权：scrypt 密码哈希 + 内存会话
 */
const crypto = require('crypto');

const sessions = new Map(); // token -> { username, expires }
const SESSION_TTL = 12 * 3600 * 1000; // 12 小时

function randomSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString('hex');
}

function verifyPassword(password, salt, hash) {
  const a = Buffer.from(hashPassword(password, salt), 'hex');
  const b = Buffer.from(String(hash || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expires: Date.now() + SESSION_TTL });
  return token;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function authMiddleware(req, res, next) {
  const token = req.cookies && req.cookies.memorial_token;
  const s = token && sessions.get(token);
  if (!s || s.expires < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: '未登录或登录已过期，请重新登录' });
  }
  s.expires = Date.now() + SESSION_TTL; // 滑动续期
  req.adminUser = s.username;
  next();
}

module.exports = { randomSalt, hashPassword, verifyPassword, createSession, destroySession, authMiddleware };
