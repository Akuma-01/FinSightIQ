import { Router } from 'express';
import * as Ann from '../controllers/annotations.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { rejectDemoCollectionWrites, requireCollectionMember } from '../middleware/collection.middleware';

const router = Router({ mergeParams: true });

router.use(verifyJWT, requireCollectionMember);

router.get('/', Ann.list);
router.post('/', rejectDemoCollectionWrites, Ann.create);
router.patch('/:id', rejectDemoCollectionWrites, Ann.update);
router.delete('/:id', rejectDemoCollectionWrites, Ann.remove);

export default router;
