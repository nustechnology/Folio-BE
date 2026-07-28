import { Router } from 'express';

import AuthController from '../controllers/auth.controller.js';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import { validateBody } from '../middlewares/validation.middleware.js';
import { loginSchema, signUpSchema } from './validators/auth.validator.js';

const router = Router();

router.post(
  '/sign-up',
  validateBody(signUpSchema),
  asyncHandler(AuthController.signUp)
);

router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(AuthController.login)
);

export default router;
