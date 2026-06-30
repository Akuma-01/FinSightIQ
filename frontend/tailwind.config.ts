import typography from '@tailwindcss/typography';
import type { Config } from 'tailwindcss';

const config: Config = {
	content: ['./src/**/*.{ts,tsx}'],
	theme: {
		extend: {
			colors: {
				critical: '#dc2626',
				moderate: '#d97706',
				minor: '#2563eb',
			},
		},
	},
	plugins: [typography],
};

export default config;
