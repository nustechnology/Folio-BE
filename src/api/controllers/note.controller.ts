import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { paginatedResponse, successResponse } from '~/api/routes/response';
import NoteService from '~/api/services/note.service';
import { NoteSort } from '~/api/types/note';

const list = async (req: Request, res: Response) => {
  const { spaceId } = req.params as { spaceId: string };
  const { search, sort, page, limit } = req.query as unknown as {
    search?: string;
    sort: NoteSort;
    page: number;
    limit: number;
  };
  const { notes, pagination } = await NoteService.list(req.userId!, spaceId, {
    search,
    sort,
    page,
    limit
  });

  return paginatedResponse(res, 'notes', notes, pagination);
};

const get = async (req: Request, res: Response) => {
  const { spaceId, noteId } = req.params as {
    spaceId: string;
    noteId: string;
  };
  const note = await NoteService.getById(req.userId!, spaceId, noteId);

  return successResponse(res, { note });
};

const create = async (req: Request, res: Response) => {
  const { spaceId } = req.params as { spaceId: string };
  const { title, content, origin } = req.body;
  const note = await NoteService.create(req.userId!, spaceId, {
    title,
    content,
    origin
  });

  return res
    .status(StatusCodes.CREATED)
    .json({ status: 'success', data: { note } });
};

export default {
  list,
  get,
  create
};
