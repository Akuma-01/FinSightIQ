import { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import * as AuthService from '../services/auth.service';

const cookieOpts = {
	httpOnly: true,
	secure: config.NODE_ENV === 'production',
	sameSite: 'strict' as const,
	maxAge: config.REFRESH_TOKEN_EXPIRES_DAYS * 86_400_000,
};

const RegisterSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8, 'Password must be at least 8 characters'),
	displayName: z.string().min(1),
	role: z.enum(['admin', 'analyst', 'compliance_officer', 'researcher']),
});

const LoginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});

export const register = asyncHandler(async (req: Request, res: Response) => {
	const parsed = RegisterSchema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

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
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const { accessToken, refreshToken, user } = await AuthService.loginUser(
		parsed.data.email,
		parsed.data.password
	);
	res.cookie('refreshToken', refreshToken, cookieOpts);
	res.json({ accessToken, user });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
	const rawToken = req.cookies?.refreshToken;
	if (!rawToken) throw new AppError(401, 'No refresh token');

	const { accessToken, refreshToken } = await AuthService.refreshAccessToken(rawToken);
	res.cookie('refreshToken', refreshToken, cookieOpts);
	res.json({ accessToken });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
	const rawToken = req.cookies?.refreshToken;
	if (rawToken) {
		await AuthService.revokeRefreshToken(rawToken).catch(() => {
			// Ignore errors — logout should always succeed from the client's perspective
		});
	}
	res.clearCookie('refreshToken');
	res.json({ message: 'Logged out' });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
	res.json({ user: req.user });
});
