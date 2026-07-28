import { Request, Response } from 'express';

import UserService from '../services/user.service.js';
import { successResponse } from '../routes/response.js';

const getOne = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = id === 'me' ? req.userId! : Number(id);
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
