import { Router } from 'express';
import * as Onboarding from '../controllers/onboarding.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { requireCollectionMember } from '../middleware/collection.middleware';
import { adminOnly } from '../middleware/rbac.middleware';

const router = Router();
router.use(verifyJWT);
router.post('/events', requireCollectionMember, Onboarding.track);
router.get('/metrics', adminOnly, Onboarding.metrics);

export default router;
