import { Response } from 'express';

export const successResponse = (res: Response, data: any) => {
  return res.status(200).json({ status: 'success', data })
}
