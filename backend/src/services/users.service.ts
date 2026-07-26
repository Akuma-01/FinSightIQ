import { db } from '../db/pool';
import { AppError } from '../middleware/error.middleware';

const ASSIGNABLE_ROLES = ['admin', 'analyst', 'compliance_officer', 'researcher'] as const;
export type AssignableRole = typeof ASSIGNABLE_ROLES[number];

export async function listUsers() {
	const { rows } = await db.query(
		`SELECT id, email, display_name AS "displayName", role, created_at AS "createdAt"
     FROM users
     ORDER BY created_at ASC`
	);
	return rows;
}

export async function updateUserRole(targetUserId: string, role: AssignableRole) {
	const { rows: targetRows } = await db.query(
		'SELECT id, role FROM users WHERE id = $1',
		[targetUserId]
	);
	if (!targetRows[0]) throw new AppError(404, 'User not found');

	if (targetRows[0].role === 'admin' && role !== 'admin') {
		const { rows: adminCountRows } = await db.query(
			`SELECT COUNT(*) AS admin_count FROM users WHERE role = 'admin' AND id != $1`,
			[targetUserId]
		);
		const remainingAdmins = parseInt(adminCountRows[0].admin_count, 10);
		if (remainingAdmins === 0) {
			throw new AppError(
				409,
				'Cannot demote the last admin. Promote another user to admin first.'
			);
		}
	}

	const { rows } = await db.query(
		`UPDATE users SET role = $1 WHERE id = $2
     RETURNING id, email, display_name AS "displayName", role, created_at AS "createdAt"`,
		[role, targetUserId]
	);
	return rows[0];
}
