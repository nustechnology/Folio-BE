import { Router } from 'express';
import UserRouter from './user.router.js';
import AuthRouter from './auth.router.js';
import PostRouter from './post.router.js';
import CommentRouter from './comment.router.js';

const router = Router();

router.use('/users', UserRouter);
router.use('/auth', AuthRouter);
router.use('/posts', PostRouter);
router.use('/comments', CommentRouter);

export default router;
