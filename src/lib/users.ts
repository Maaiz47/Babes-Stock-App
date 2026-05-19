import { sql } from '@vercel/postgres';
import { compare, hash } from 'bcryptjs';
import crypto from 'crypto';

export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

function mapUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email),
    password_hash: String(row.password_hash),
    is_admin: Boolean(row.is_admin),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function getUserByIdentifier(identifier: string): Promise<User | null> {
  const result = await sql`
    SELECT * FROM users WHERE username = ${identifier} OR email = ${identifier} LIMIT 1
  `;
  return result.rows.length > 0 ? mapUser(result.rows[0]) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
  return result.rows.length > 0 ? mapUser(result.rows[0]) : null;
}

export async function getAllUsers(): Promise<Omit<User, 'password_hash'>[]> {
  const result = await sql`SELECT id, username, email, is_admin, created_at, updated_at FROM users ORDER BY created_at ASC`;
  return result.rows.map(r => ({
    id: String(r.id),
    username: String(r.username),
    email: String(r.email),
    is_admin: Boolean(r.is_admin),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  }));
}

export async function createUser(username: string, email: string, password: string, isAdmin = false): Promise<User> {
  const password_hash = await hash(password, 10);
  const result = await sql`
    INSERT INTO users (username, email, password_hash, is_admin)
    VALUES (${username.toLowerCase()}, ${email.toLowerCase()}, ${password_hash}, ${isAdmin})
    RETURNING *
  `;
  return mapUser(result.rows[0]);
}

export async function updateUserPassword(userId: string, newPassword: string): Promise<void> {
  const password_hash = await hash(newPassword, 10);
  await sql`UPDATE users SET password_hash = ${password_hash}, updated_at = NOW() WHERE id = ${userId}`;
}

export async function deleteUser(userId: string): Promise<void> {
  await sql`DELETE FROM users WHERE id = ${userId}`;
}

export async function verifyPassword(user: User, password: string): Promise<boolean> {
  return compare(password, user.password_hash);
}

export async function createResetToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await sql`
    INSERT INTO password_reset_tokens (user_id, token, expires_at)
    VALUES (${userId}, ${token}, ${expiresAt.toISOString()})
  `;
  return token;
}

export async function validateResetToken(token: string): Promise<string | null> {
  const result = await sql`
    SELECT user_id FROM password_reset_tokens
    WHERE token = ${token} AND used = false AND expires_at > NOW()
    LIMIT 1
  `;
  return result.rows.length > 0 ? String(result.rows[0].user_id) : null;
}

export async function markResetTokenUsed(token: string): Promise<void> {
  await sql`UPDATE password_reset_tokens SET used = true WHERE token = ${token}`;
}

export async function updateUserEmail(userId: string, newEmail: string): Promise<void> {
  await sql`UPDATE users SET email = ${newEmail.toLowerCase()}, updated_at = NOW() WHERE id = ${userId}`;
}

export async function createEmailChangeRequest(userId: string, newEmail: string): Promise<string> {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  await sql`DELETE FROM email_change_requests WHERE user_id = ${userId}`;
  await sql`
    INSERT INTO email_change_requests (user_id, new_email, code, expires_at)
    VALUES (${userId}, ${newEmail.toLowerCase()}, ${code}, ${expiresAt.toISOString()})
  `;
  return code;
}

export async function validateEmailChangeCode(userId: string, code: string): Promise<string | null> {
  const result = await sql`
    SELECT new_email FROM email_change_requests
    WHERE user_id = ${userId} AND code = ${code} AND used = false AND expires_at > NOW()
    LIMIT 1
  `;
  return result.rows.length > 0 ? String(result.rows[0].new_email) : null;
}

export async function markEmailChangeUsed(userId: string): Promise<void> {
  await sql`UPDATE email_change_requests SET used = true WHERE user_id = ${userId}`;
}

export async function usernameExists(username: string): Promise<boolean> {
  const r = await sql`SELECT id FROM users WHERE username = ${username.toLowerCase()} LIMIT 1`;
  return r.rows.length > 0;
}

export async function emailExists(email: string): Promise<boolean> {
  const r = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()} LIMIT 1`;
  return r.rows.length > 0;
}
