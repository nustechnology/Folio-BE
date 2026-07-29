import { Router } from 'express';
import UserRouter from '~/api/routes/user.router';
import AuthRouter from '~/api/routes/auth.router';

const router = Router();

router.use('/users', UserRouter);
router.use('/auth', AuthRouter);

export default router;
