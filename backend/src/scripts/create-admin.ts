import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { registerUser } from '../services/auth.service';

function readArg(flag: string): string | undefined {
	const prefix = `--${flag}=`;
	const match = process.argv.find((arg) => arg.startsWith(prefix));
	return match?.slice(prefix.length);
}

async function main() {
	const email = readArg('email');
	if (!email) {
		throw new Error('Usage: npm run create:admin -- --email=you@company.com [--password=... --name="..."]');
	}

	const { rows } = await db.query('SELECT id, role FROM users WHERE email = $1', [email]);
	const existing = rows[0];

	if (existing) {
		if (existing.role === 'admin') {
			logger.info({ email }, 'User is already an admin — nothing to do');
			return;
		}
		await db.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', existing.id]);
		logger.info({ email, previousRole: existing.role }, '✓ Existing user promoted to admin');
		return;
	}

	const password = readArg('password');
	const name = readArg('name') ?? email.split('@')[0];
	if (!password) {
		throw new Error(`No user found with email ${email}. To create a new admin, also pass --password=... --name="..."`);
	}
	if (password.length < 8) {
		throw new Error('Password must be at least 8 characters');
	}

	const user = await registerUser(email, password, name, 'admin');
	logger.info({ email: user.email, id: user.id }, '✓ New admin created');
}

main()
	.catch((err) => {
		logger.error(err instanceof Error ? err.message : err, 'create-admin failed');
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.end();
	});
