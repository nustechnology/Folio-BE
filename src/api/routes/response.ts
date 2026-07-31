import { StatusCodes } from 'http-status-codes';
import { Response } from 'express';

export const successResponse = (res: Response, data: any) => {
  return res.status(StatusCodes.OK).json({ status: 'success', data })
}
