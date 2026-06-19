import { Router } from 'express';
import * as Ann from '../controllers/annotations.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { requireCollectionMember } from '../middleware/collection.middleware';

const router = Router({ mergeParams: true });

router.use(verifyJWT, requireCollectionMember);

router.get('/', Ann.list);
router.post('/', Ann.create);
router.patch('/:id', Ann.update);
router.delete('/:id', Ann.remove);

export default router;
