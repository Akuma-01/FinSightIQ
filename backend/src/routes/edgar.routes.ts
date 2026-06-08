import { Router } from 'express';
import { fetchFiling } from '../controllers/edgar.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { canUpload } from '../middleware/rbac.middleware';

const router = Router();

router.post('/fetch', verifyJWT, canUpload, fetchFiling);

export default router;
