import { Request, Response } from 'express';

import AuthService from '~/api/services/auth.service';
import { successResponse } from '~/api/routes/response';

const signUp = async (req: Request, res: Response) => {
  const { name, email, password } = req.body;
  const result = await AuthService.signUp({ name, email, password });

  return successResponse(res, result);
};

const login = async (req: Request, res: Response) => {
  const result = await AuthService.login(req.body);

  return successResponse(res, result);
};

const refresh = async (req: Request, res: Response) => {
  const result = await AuthService.refresh(req.body);

  return successResponse(res, result);
};

const logout = async (req: Request, res: Response) => {
  await AuthService.logout(req.userId!);

  return successResponse(res, { success: true });
};

export default {
  signUp,
  login,
  refresh,
  logout
};
