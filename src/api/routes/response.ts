import { StatusCodes } from 'http-status-codes';
import { Response } from 'express';

export const successResponse = <T>(res: Response, data: T) => {
  return res.status(StatusCodes.OK).json({ status: 'success', data });
};
