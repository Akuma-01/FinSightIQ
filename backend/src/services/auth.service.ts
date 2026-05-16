import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from '../db/pool';
import { AuthUser } from '../types/express';

const BCRYPT_ROUNDS = 12;
const VALID_ROLES = ['admin', 'analyst', 'compliance_officer', 'researcher'] as const;
type Role = typeof VALID_ROLES[number];

// ─── Registration ─────────────────────────────────────────────────────────────

export async function registerUser(
	email: string,
	password: string,
	displayName: string,
	role: string
) {
	if (!VALID_ROLES.includes(role as Role)) {
		throw new Error(`Invalid role: ${role}`);
	}
	const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
	if (existing.rows.length > 0) throw new Error('Email already registered');

	const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
	const result = await db.query(
		`INSERT INTO users (email, password_hash, role, display_name)
		VALUES ($1, $2, $3, $4)
		RETURNING id, email, role, display_name as "displayName"`,
		[email, passwordHash, role, displayName]
	);
	return result.rows[0];
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function loginUser(
	email: string,
	password: string,
) {
	const result = await db.query('SELECT id, email, password_hash, role, display_name FROM users WHERE email = $1', [email]);

	if (result.rows.length === 0) throw new Error('Invalid credentials');

	const user = result.rows[0];
	const valid = await bcrypt.compare(password, user.password_hash);
	if (!valid) throw new Error('Invalid credentials');

	const payload: AuthUser = { id: user.id, email: user.email, role: user.role };
	const accessToken = signAccessToken(payload);
	const { rawToken } = await createRefreshToken(user.id);

	return {
		accessToken,
		refreshToken: rawToken,
		user: { id: user.id, email: user.email, role: user.role },
	};
}

// ─── Refresh token rotation ───────────────────────────────────────────────────

export async function refreshAccessToken(rawToken: string) {
	const tokenHash = hashToken(rawToken);

	const result = await db.query(
		`SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked,
			u.email, u.role
		FROM refresh_tokens rt
		JOIN users u ON u.id = rt.user_id
		WHERE rt.token_hash = $1`,
		[tokenHash]
	);
	if (result.rows.length === 0) throw new Error('Invalid refresh token');

	const row = result.rows[0];
	if (row.revoked) throw new Error('Refresh token revoked');
	if (new Date(row.expires_at) < new Date()) throw new Error('Refresh token expired');

	// Rotate: revoke old, issue new
	await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [row.id]);
	const { rawToken: newRaw } = await createRefreshToken(row.user_id);

	const accessToken = signAccessToken({ id: row.user_id, email: row.email, role: row.role });
	return { accessToken, refreshToken: newRaw };
}

// ─── Logout ──────────────────────────────────────────────────────────────────

export async function revokeRefreshToken(rawToken: string) {
	const tokenHash = hashToken(rawToken);
	await db.query(
		'UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1',
		[tokenHash]
	);
}

// ─── Token helpers ───────────────────────────────────────────────────────────

export function signAccessToken(payload: AuthUser): string {
	return jwt.sign(payload, process.env.JWT_SECRET!, {
		expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
	} as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AuthUser {
	return jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
}

async function createRefreshToken(userId: string) {
	const rawToken = crypto.randomBytes(48).toString('hex');
	const tokenHash = hashToken(rawToken);
	const days = parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? '7', 10);
	const expiresAt = new Date(Date.now() + days * 86_400_000);

	await db.query(
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)`,
		[userId, tokenHash, expiresAt]
	);
	return { rawToken };
}

function hashToken(raw: string): string {
	return crypto.createHash('sha256').update(raw).digest('hex');
}
