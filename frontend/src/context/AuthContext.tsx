'use client';
import { auth as authAPI, registerRefreshCallback } from '@/lib/api';
import type { User } from '@/types/api';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const REFRESH_INTERVAL_MS =
	Number.parseInt(process.env.NEXT_PUBLIC_TOKEN_REFRESH_MINUTES ?? '50', 10) * 60_000;

interface AuthContextValue {
	user: User | null;
	token: string | null;
	loading: boolean;
	login: (email: string, password: string) => Promise<void>;
	logout: () => Promise<void>;
	refreshToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [token, setToken] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const refreshToken = useCallback(async (): Promise<string | null> => {
		try {
			const { accessToken } = await authAPI.refresh();
			setToken(accessToken);
			return accessToken;
		} catch {
			setToken(null);
			setUser(null);
			return null;
		}
	}, []);

	useEffect(() => {
		registerRefreshCallback(refreshToken);
	}, [refreshToken]);

	useEffect(() => {
		authAPI.refresh()
			.then(({ accessToken }) => {
				setToken(accessToken);
				return authAPI.me(accessToken);
			})
			.then(({ user: u }) => setUser(u))
			.catch(() => { setUser(null); setToken(null); })
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		clearTimeout(refreshTimerRef.current ?? undefined);
		if (!token) return;

		refreshTimerRef.current = setTimeout(() => {
			void refreshToken();
		}, REFRESH_INTERVAL_MS);

		return () => clearTimeout(refreshTimerRef.current ?? undefined);
	}, [refreshToken, token]);

	const login = useCallback(async (email: string, password: string) => {
		const { accessToken, user: u } = await authAPI.login(email, password);
		setToken(accessToken);
		setUser(u);
	}, []);

	const logout = useCallback(async () => {
		clearTimeout(refreshTimerRef.current ?? undefined);
		await authAPI.logout().catch(() => { });
		setToken(null);
		setUser(null);
	}, []);

	return (
		<AuthContext.Provider value={{ user, token, loading, login, logout, refreshToken }}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
	return ctx;
}
