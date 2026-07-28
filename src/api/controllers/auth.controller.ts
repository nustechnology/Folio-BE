import { Request, Response } from 'express';

import AuthService from '../services/auth.service.js';
import { successResponse } from '../routes/response.js';

const signUp = async (req: Request, res: Response) => {
  const { name, email, password } = req.body;
  const user = await AuthService.signUp({ name, email, password });

  return successResponse(res, { user });
};

const login = async (req: Request, res: Response) => {
  const token = await AuthService.login(req.body);

  return successResponse(res, { token });
};

export default {
  signUp,
  login,
};
