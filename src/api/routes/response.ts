import { StatusCodes } from 'http-status-codes';
import { Response } from 'express';

export const successResponse = <T>(res: Response, data: T) => {
  return res.status(StatusCodes.OK).json({ status: 'success', data });
};

export type PaginationMeta = {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
};

export const paginatedResponse = <T>(
  res: Response,
  key: string,
  items: T[],
  pagination: PaginationMeta
) => {
  return res.status(StatusCodes.OK).json({
    status: 'success',
    data: {
      [key]: items,
      pagination
    }
  });
};
