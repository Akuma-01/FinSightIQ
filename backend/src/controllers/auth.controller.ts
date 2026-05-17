import { Request, Response } from "express";
import { parse } from "path";
import { z } from 'zod';
import * as AuthService from '../services/auth.service';

const COOKIE_OPTIONS = (days: number) => ({
	httpOnly: true,
	secure: process.env.NODE_ENV === 'production',
	sameSite: 'strict' as const,
	maxAge: days * 86_400_000,
});

const RegisterSchema = z.object({
	email: z.email(),
	password: z.string().min(8, 'Password must be at least 8 characters'),
	displayName: z.string().min(1),
	role: z.enum(['admin', 'analyst', 'compliance_officer', 'researcher']),
});

const LoginSchema = z.object({
	email: z.email(),
	password: z.string().min(1),
});

export async function register(req: Request, res: Response) {
	const parsed = RegisterSchema.safeParse(req.body);
	if (!parsed.success) return res.status(400).json({ error: z.flattenError(parsed.error) });

	try {
		const user = await AuthService.registerUser(
			parsed.data.email,
			parsed.data.password,
			parsed.data.displayName,
			parsed.data.role
		);
		res.status(201).json({ user });
	} catch (e: any) {
		const status = e.message === 'Email already registered' ? 409 : 500;
		res.status(status).json({ error: e.message });
	}
}

export async function login(req: Request, res: Response) {
	const parsed = LoginSchema.safeParse(req.body);
	if (!parsed.success) return res.status(400).json({ error: z.flattenError(parsed.error) });

	try {
		const days = parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? '7', 10);
		const { accessToken, refreshToken, user } = await AuthService.loginUser(
			parsed.data.email,
			parsed.data.password
		);
		res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS(days));
		res.json({ accessToken, user });

	} catch (e: any) {
		res.status(401).json({ error: e.message });
	}
}

export async function refresh(req: Request, res: Response) {
	const rawToken = req.cookies?.refreshToken;
	if (!rawToken) return res.status(401).json({ error: 'No refresh token' });

	try {
		const days = parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? '7', 10);
		const { accessToken, refreshToken } = await AuthService.refreshAccessToken(rawToken);
		res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS(days));
		res.json({ accessToken });
	} catch (e: any) {
		res.clearCookie('refreshToken');
		res.status(401).json({ error: e.message });
	}
}

export async function logout(req: Request, res: Response) {
	const rawToken = req.cookies?.refreshToken;
	if (rawToken) await AuthService.refreshAccessToken(rawToken).catch(() => { });
	res.clearCookie('refreshToken');
	res.json({ message: 'Logged out' });
}

export async function me(req: Request, res: Response) {
	res.json({ user: req.user });
}
