import { Router } from 'express';
import * as Collections from '../controllers/collections.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { requireCollectionMember } from '../middleware/collection.middleware';
import { adminOnly, canUpload } from '../middleware/rbac.middleware';
import documentsRoutes from './documents.routes';

const router = Router();

// All collection routes require authentication
router.use(verifyJWT);

router.get('/', Collections.list);
router.post('/', canUpload, Collections.create);

router.use('/:collectionId/documents', documentsRoutes);

router.get('/:id', requireCollectionMember, Collections.getOne);
router.patch('/:id', requireCollectionMember, canUpload, Collections.update);
router.delete('/:id', requireCollectionMember, adminOnly, Collections.remove);

router.get('/:id/members', requireCollectionMember, adminOnly, Collections.listMembers);
router.post('/:id/members', requireCollectionMember, adminOnly, Collections.addMember);
router.delete('/:id/members/:uid', requireCollectionMember, adminOnly, Collections.removeMember);

export default router;
