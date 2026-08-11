import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { paginatedResponse, successResponse } from '~/api/routes/response';
import NoteService from '~/api/services/note.service';
import {
  ConvertNoteInput,
  NoteOriginFilter,
  NoteSort,
  UpdateNoteInput
} from '~/api/types/note';

const list = async (req: Request, res: Response) => {
  const { spaceId } = req.params as { spaceId: string };
  const { search, sort, origin, page, limit } = req.query as unknown as {
    search?: string;
    sort: NoteSort;
    origin: NoteOriginFilter;
    page: number;
    limit: number;
  };
  const { notes, pagination } = await NoteService.list(req.userId!, spaceId, {
    search,
    sort,
    origin,
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

const update = async (req: Request, res: Response) => {
  const { spaceId, noteId } = req.params as {
    spaceId: string;
    noteId: string;
  };
  const { title, content } = req.body as UpdateNoteInput;
  const note = await NoteService.update(req.userId!, spaceId, noteId, {
    title,
    content
  });

  return successResponse(res, { note });
};

/**
 * Answers `201` with the created source, not with the note: the note is
 * unchanged by the conversion, and the caller's next move is to watch the new
 * source through processing.
 */
const convertToSource = async (req: Request, res: Response) => {
  const { spaceId, noteId } = req.params as {
    spaceId: string;
    noteId: string;
  };
  const { title } = (req.body ?? {}) as ConvertNoteInput;
  const source = await NoteService.convertToSource(
    req.userId!,
    spaceId,
    noteId,
    { title }
  );

  return res
    .status(StatusCodes.CREATED)
    .json({ status: 'success', data: { source } });
};

/**
 * Answers `200` with the standard envelope rather than `204`, so the response
 * shape matches every other route and the web client's JSON parsing.
 */
const remove = async (req: Request, res: Response) => {
  const { spaceId, noteId } = req.params as {
    spaceId: string;
    noteId: string;
  };
  await NoteService.remove(req.userId!, spaceId, noteId);

  return successResponse(res, { deleted: true });
};

export default {
  list,
  get,
  create,
  update,
  convertToSource,
  remove
};
