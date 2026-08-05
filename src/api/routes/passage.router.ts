import { Router } from 'express';
import Joi from 'joi';

import PassageController from '~/api/controllers/passage.controller';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import { validateParams } from '~/api/middlewares/validation.middleware';

const router = Router();

const passageIdParamSchema = Joi.object({
  passageId: Joi.string().guid().required()
});

router.get(
  '/:passageId',
  auth,
  validateParams(passageIdParamSchema),
  asyncHandler(PassageController.getPassageById)
);

export default router;
