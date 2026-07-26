import { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import * as UsersService from '../services/users.service';

const UpdateRoleSchema = z.object({
	role: z.enum(['admin', 'analyst', 'compliance_officer', 'researcher']),
});

function getUuidParam(req: Request, name: string): string {
	const parsed = z.uuid().safeParse(req.params[name]);
	if (!parsed.success) throw new AppError(400, `Invalid ${name}`);
	return parsed.data;
}

export const list = asyncHandler(async (_req: Request, res: Response) => {
	const users = await UsersService.listUsers();
	res.json({ users });
});

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
	const userId = getUuidParam(req, 'id');
	const parsed = UpdateRoleSchema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const user = await UsersService.updateUserRole(userId, parsed.data.role);
	res.json({ user });
});
