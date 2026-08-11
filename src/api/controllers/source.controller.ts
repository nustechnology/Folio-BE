import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import Joi from 'joi';

import { AppError } from '~/api/errors/app.error';
import SourceService from '~/api/services/source.service';
import SseService from '~/api/services/sse.service';
import { paginatedResponse, successResponse } from '~/api/routes/response';
import {
  createFileSourceSchema,
  createManualSourceSchema,
  createWebSourceSchema
} from '~/api/routes/validators/source.validator';
import { ListSourceOptions } from '~/api/types/source';

const validate = async (schema: Joi.ObjectSchema, value: unknown) => {
  try {
    return await schema.validateAsync(value, { abortEarly: false });
  } catch (error) {
    if (Joi.isError(error)) {
      throw new AppError(error.message, StatusCodes.BAD_REQUEST);
    }
    throw error;
  }
};

const create = async (req: Request, res: Response) => {
  if (req.file) {
    const data = await validate(createFileSourceSchema, req.body);
    const source = await SourceService.createFile(
      data.spaceId,
      req.userId!,
      req.file,
      data
    );
    return res
      .status(StatusCodes.CREATED)
      .json({ status: 'success', data: { source } });
  }

  const { spaceId } = req.body as { spaceId: string };
  const { sourceType } = req.body as { sourceType?: string };

  if (sourceType === 'Web') {
    const data = await validate(createWebSourceSchema, req.body);
    const source = await SourceService.createWeb(spaceId, req.userId!, data);
    return res
      .status(StatusCodes.CREATED)
      .json({ status: 'success', data: { source } });
  }

  if (sourceType === 'Manual') {
    const data = await validate(createManualSourceSchema, req.body);
    const source = await SourceService.createManual(spaceId, req.userId!, data);
    return res
      .status(StatusCodes.CREATED)
      .json({ status: 'success', data: { source } });
  }

  throw new AppError('Invalid source type', StatusCodes.BAD_REQUEST);
};

const list = async (req: Request, res: Response) => {
  const { spaceId, sourceType, processingState, search, sort, page, limit } =
    req.query as unknown as Partial<ListSourceOptions> & {
      spaceId: string;
      sort?: string;
    };
  const { sources, pagination } = await SourceService.list(
    spaceId,
    req.userId!,
    {
      sourceType,
      processingState,
      search,
      sort: (sort ?? 'recently-added') as ListSourceOptions['sort'],
      page: page ?? 1,
      limit: limit ?? 10
    }
  );
  return paginatedResponse(res, 'sources', sources, pagination);
};

const getById = async (req: Request, res: Response) => {
  const { sourceId } = req.params;
  const source = await SourceService.getById(sourceId, req.userId!);
  return successResponse(res, { source });
};

const remove = async (req: Request, res: Response) => {
  const { sourceId } = req.params;
  const result = await SourceService.remove(sourceId, req.userId!);
  return successResponse(res, result);
};

const retry = async (req: Request, res: Response) => {
  const { sourceId } = req.params;
  const source = await SourceService.retry(sourceId, req.userId!);
  return successResponse(res, { source });
};

const status = async (req: Request, res: Response) => {
  await SseService.streamAllStatus(req.userId!, res);
};

export default {
  create,
  list,
  getById,
  remove,
  retry,
  status
};
