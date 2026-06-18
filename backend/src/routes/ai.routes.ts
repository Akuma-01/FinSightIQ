import { Router } from 'express';
import * as AI from '../controllers/ai.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { requireCollectionMember } from '../middleware/collection.middleware';
import {
	contradictRateLimit,
	searchRateLimit,
	summarizeRateLimit,
} from '../middleware/rateLimit.middleware';
import { canResolve } from '../middleware/rbac.middleware';

const router = Router();
router.use(verifyJWT);

// Contradiction scan
router.post('/contradict/:collectionId',
	requireCollectionMember, contradictRateLimit, AI.scanCollection);

router.post('/contradict/targeted',
	contradictRateLimit, AI.scanTargeted);

router.get('/contradictions/:collectionId',
	requireCollectionMember, AI.listContradictions);

router.patch('/contradictions/:id/resolve',
	canResolve, AI.resolveContradiction);

// Stale references
router.get('/stale/:collectionId',
	requireCollectionMember, AI.listStaleRefs);

router.patch('/stale/:id/resolve',
	canResolve, AI.resolveStaleRef);

// Search
router.post('/search',
	searchRateLimit, AI.search);

// Summarization
router.post('/summarize/document/:documentId',
	summarizeRateLimit, AI.summarizeDocument);

router.post('/summarize/collection/:collectionId',
	requireCollectionMember, summarizeRateLimit, AI.summarizeCollection);

export default router;
