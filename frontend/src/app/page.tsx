'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
	const { token, loading } = useAuth();
	const router = useRouter();

	useEffect(() => {
		if (loading) return;
		router.replace(token ? '/collections' : '/login');
	}, [loading, router, token]);

	return (
		<main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-300">
			Loading FinSightIQ…
		</main>
	);
}
