import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../db/pool.js';

const REFRESH_EXPIRY_DAYS = parseInt(process.env.JWT_REFRESH_EXPIRY || '604800') / 86400;

export async function signUp(email, password) {
  const existing = await query('SELECT id FROM auth_users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw Object.assign(new Error('Email already registered'), { statusCode: 409 });
  }

  const hash = await bcrypt.hash(password, 12);
  const result = await query(
    `INSERT INTO auth_users (email, password_hash) VALUES ($1, $2) RETURNING id, email, role, created_at`,
    [email, hash]
  );

  const user = result.rows[0];

  // Create empty profile
  await query(`INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [user.id]);

  return user;
}

export async function signIn(email, password) {
  const result = await query(
    `SELECT id, email, password_hash, role FROM auth_users WHERE email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  }

  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  }

  return { id: user.id, email: user.email, role: user.role };
}

export async function createRefreshToken(userId) {
  const token = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_EXPIRY_DAYS);

  await query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );

  return token;
}

export async function rotateRefreshToken(oldToken) {
  const result = await query(
    `SELECT rt.user_id, au.email, au.role
     FROM refresh_tokens rt
     JOIN auth_users au ON au.id = rt.user_id
     WHERE rt.token = $1 AND rt.expires_at > NOW()`,
    [oldToken]
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('Invalid or expired refresh token'), { statusCode: 401 });
  }

  // Delete old token (rotation)
  await query(`DELETE FROM refresh_tokens WHERE token = $1`, [oldToken]);

  const user = result.rows[0];
  const newToken = await createRefreshToken(user.user_id);

  return { user: { id: user.user_id, email: user.email, role: user.role }, refreshToken: newToken };
}

export async function revokeRefreshToken(token) {
  await query(`DELETE FROM refresh_tokens WHERE token = $1`, [token]);
}
