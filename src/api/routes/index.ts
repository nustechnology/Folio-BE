import { Router } from 'express';
import UserRouter from '~/api/routes/user.router';
import AuthRouter from '~/api/routes/auth.router';
import SpaceRouter from '~/api/routes/space.router';

const router = Router();

router.use('/users', UserRouter);
router.use('/auth', AuthRouter);
router.use('/spaces', SpaceRouter);

export default router;
