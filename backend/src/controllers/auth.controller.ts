import { Request, Response } from "express";
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/error.middleware';
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

export const register = asyncHandler(async (req: Request, res: Response) => {
	const parsed = RegisterSchema.safeParse(req.body);
	if (!parsed.success) throw parsed.error;

	const user = await AuthService.registerUser(
		parsed.data.email,
		parsed.data.password,
		parsed.data.displayName,
		parsed.data.role
	);
	res.status(201).json({ user });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
	const parsed = LoginSchema.safeParse(req.body);
	if (!parsed.success) throw parsed.error;

	const days = parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? '7', 10);
	const { accessToken, refreshToken, user } = await AuthService.loginUser(
		parsed.data.email,
		parsed.data.password
	);
	res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS(days));
	res.json({ accessToken, user });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
	const rawToken = req.cookies?.refreshToken;
	if (!rawToken) throw new AppError(401, 'No refresh token');

	const days = parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? '7', 10);
	const { accessToken, refreshToken } = await AuthService.refreshAccessToken(rawToken);
	res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS(days));
	res.json({ accessToken });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
	const rawToken = req.cookies?.refreshToken;
	if (rawToken) await AuthService.revokeRefreshToken(rawToken);
	res.clearCookie('refreshToken');
	res.json({ message: 'Logged out' });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
	res.json({ user: req.user });
});
