import { Request, Response } from 'express';

import { successResponse } from '~/api/routes/response';
import NotebookService from '~/api/services/notebook.service';
import { SaveNotebookInput } from '~/api/types/notebook';

const get = async (req: Request, res: Response) => {
  const { spaceId } = req.params as { spaceId: string };
  const notebook = await NotebookService.get(req.userId!, spaceId);

  return successResponse(res, { notebook });
};

const save = async (req: Request, res: Response) => {
  const { spaceId } = req.params as { spaceId: string };
  const { content } = req.body as SaveNotebookInput;
  const notebook = await NotebookService.save(req.userId!, spaceId, content);

  return successResponse(res, { notebook });
};

export default {
  get,
  save
};
