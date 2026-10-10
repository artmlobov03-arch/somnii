import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const cookieName = 'somnii_session';
const lifetime = 30 * 24 * 60 * 60 * 1000;
export const publicUser = user => ({ id: user.id, name: user.name, email: user.email, createdAt: user.created_at });
export const digest = value => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}
export function sessionToken(req) {
  return (req.headers.cookie || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
}
export function sessionCookie(req, token, remove = false) {
  const secure = process.env.RENDER || process.env.NODE_ENV === 'production' || req.socket.encrypted;
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${remove ? 0 : lifetime / 1000}${secure ? '; Secure' : ''}`;
}
export async function startSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  await db.query('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [digest(token), userId, Date.now() + lifetime]);
  return token;
}
export async function currentUser(db, req) {
  const token = sessionToken(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const [user] = await db.query('SELECT users.* FROM users JOIN sessions ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?', [digest(token), Date.now()]);
  return user || null;
}
export { randomUUID };
