import { Router } from 'express';
import * as Documents from '../controllers/documents.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { adminOnly } from '../middleware/rbac.middleware';

const router = Router();

router.use(verifyJWT);
router.post('/:documentId/retry', adminOnly, Documents.retry);

export default router;
