import { Router } from 'express';
import * as LLM from '../controllers/llm.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { adminOnly, researchAccess } from '../middleware/rbac.middleware';

const router = Router();
router.use(verifyJWT);

router.get('/models', LLM.getModels);
router.get('/logs', researchAccess, LLM.getLogs);
router.get('/prompts', researchAccess, LLM.listPrompts);
router.post('/prompts', adminOnly, LLM.createPrompt);
router.patch('/prompts/:id/activate', adminOnly, LLM.activatePrompt);

export default router;
