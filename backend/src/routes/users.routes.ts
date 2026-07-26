import { Router } from 'express';
import * as Users from '../controllers/users.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { adminOnly } from '../middleware/rbac.middleware';

const router = Router();

router.use(verifyJWT, adminOnly);

router.get('/', Users.list);
router.patch('/:id/role', Users.updateRole);

export default router;
