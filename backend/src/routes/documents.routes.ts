import { Router } from 'express';
import * as Documents from '../controllers/documents.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { rejectDemoCollectionWrites, requireCollectionMember } from '../middleware/collection.middleware';
import { adminOnly, canUpload } from '../middleware/rbac.middleware';

const router = Router({ mergeParams: true }); // inherits :collectionId from parent

router.use(verifyJWT, requireCollectionMember);

router.get('/', Documents.list);
router.get('/:documentId', Documents.getOne);
router.post('/', rejectDemoCollectionWrites, canUpload, Documents.uploadOne);
router.delete('/:documentId', rejectDemoCollectionWrites, adminOnly, Documents.remove);
router.post('/:documentId/retry', rejectDemoCollectionWrites, adminOnly, Documents.retry);

export default router;
