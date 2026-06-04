import { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import * as CollectionsService from '../services/collections.service';

const CreateSchema = z.object({
	name: z.string().min(1).max(120),
	chunkingStrategy: z.enum(['fixed_256', 'fixed_512', 'sentence', 'section_aware'])
		.default('sentence'),
});

const UpdateSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	archived: z.boolean().optional(),
});

const MemberSchema = z.object({
	userId: z.uuid(),
	accessRole: z.enum(['owner', 'editor', 'viewer']).default('viewer'),
});

function getUuidParam(req: Request, name: string): string {
	const parsed = z.uuid().safeParse(req.params[name]);
	if (!parsed.success) throw new AppError(400, `Invalid ${name}`);
	return parsed.data;
}

export const list = asyncHandler(async (req: Request, res: Response) => {
	const collections = await CollectionsService.listCollections(req.user!);
	res.json({ collections });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
	const parsed = CreateSchema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const collection = await CollectionsService.createCollection(
		parsed.data.name,
		parsed.data.chunkingStrategy,
		req.user!.id
	);
	res.status(201).json({ collection });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
	const collectionId = getUuidParam(req, 'id');
	const collection = await CollectionsService.getCollection(collectionId);
	res.json({ collection });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
	const parsed = UpdateSchema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const collectionId = getUuidParam(req, 'id');
	const collection = await CollectionsService.updateCollection(collectionId, parsed.data);
	res.json({ collection });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
	const collectionId = getUuidParam(req, 'id');
	await CollectionsService.deleteCollection(collectionId);
	res.json({ message: 'Collection deleted' });
});

export const listMembers = asyncHandler(async (req: Request, res: Response) => {
	const collectionId = getUuidParam(req, 'id');
	const members = await CollectionsService.listMembers(collectionId);
	res.json({ members });
});

export const addMember = asyncHandler(async (req: Request, res: Response) => {
	const parsed = MemberSchema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const collectionId = getUuidParam(req, 'id');
	const member = await CollectionsService.addMember(
		collectionId,
		parsed.data.userId,
		parsed.data.accessRole
	);
	res.status(201).json({ member });
});

export const removeMember = asyncHandler(async (req: Request, res: Response) => {
	const collectionId = getUuidParam(req, 'id');
	const userId = getUuidParam(req, 'uid');
	await CollectionsService.removeMember(collectionId, userId);
	res.json({ message: 'Member removed' });
});
