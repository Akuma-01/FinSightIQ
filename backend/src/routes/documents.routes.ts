import { Router } from 'express';
import * as Documents from '../controllers/documents.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { requireCollectionMember } from '../middleware/collection.middleware';
import { adminOnly, canUpload } from '../middleware/rbac.middleware';

const router = Router({ mergeParams: true }); // inherits :collectionId from parent

router.use(verifyJWT, requireCollectionMember);

router.get('/', Documents.list);
router.get('/:documentId', Documents.getOne);
router.post('/', canUpload, Documents.uploadOne);
router.delete('/:documentId', adminOnly, Documents.remove);
router.post('/:documentId/retry', adminOnly, Documents.retry);

export default router;
