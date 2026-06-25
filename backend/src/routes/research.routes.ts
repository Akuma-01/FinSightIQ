import { Router } from 'express';
import * as Research from '../controllers/research.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { benchmarkRateLimit } from '../middleware/rateLimit.middleware';
import { researchAccess } from '../middleware/rbac.middleware';

const router = Router();
router.use(verifyJWT, researchAccess);

router.get('/metrics', Research.getMetrics);
router.get('/hallucination', Research.getHallucination);
router.post('/benchmark', benchmarkRateLimit, Research.runBenchmark);
router.get('/benchmark/history', Research.getBenchmarkHistory);
router.get('/export', Research.exportData);

export default router;
