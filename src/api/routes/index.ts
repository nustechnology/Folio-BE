import { Router } from 'express';
import UserRouter from '~/api/routes/user.router';
import AuthRouter from '~/api/routes/auth.router';
import SpaceRouter from '~/api/routes/space.router';
import SourceRouter from '~/api/routes/source.router';

const router = Router();

router.use('/users', UserRouter);
router.use('/auth', AuthRouter);
router.use('/spaces', SpaceRouter);
router.use('/sources', SourceRouter);

export default router;
