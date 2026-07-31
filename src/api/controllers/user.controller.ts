import { Request, Response } from 'express';

import UserService from '~/api/services/user.service';
import { successResponse } from '~/api/routes/response';

const getOne = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = id === 'me' ? req.userId! : id;
  const user = await UserService.getOne(userId);

  return successResponse(res, { user });
};

const updateProfile = async (req: Request, res: Response) => {
  const { name, email, address } = req.body;
  const user = await UserService.update(req.userId!, { name, email, address });

  return successResponse(res, { user });
};

export default {
  getOne,
  updateProfile,
};
