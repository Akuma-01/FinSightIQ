import { Router } from 'express';
import * as Auth from '../controllers/auth.controller';
import { verifyJWT } from '../middleware/auth.middleware';

const router = Router();

router.post('/register', Auth.register);
router.post('/login', Auth.login);
router.post('/refresh', Auth.refresh);
router.post('/logout', Auth.logout);
router.get('/me', verifyJWT, Auth.me);

export default router;
