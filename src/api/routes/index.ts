import { Router } from 'express';
import UserRouter from '~/api/routes/user.router';
import AuthRouter from '~/api/routes/auth.router';
import SpaceRouter from '~/api/routes/space.router';
import SourceRouter from '~/api/routes/source.router';
import PassageRouter from '~/api/routes/passage.router';

const router = Router();

router.use('/users', UserRouter);
router.use('/auth', AuthRouter);
router.use('/spaces', SpaceRouter);
router.use('/sources', SourceRouter);
router.use('/passages', PassageRouter);

export default router;
