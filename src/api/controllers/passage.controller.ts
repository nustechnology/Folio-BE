import { Request, Response } from 'express';

import PassageService from '~/api/services/passage.service';
import { successResponse } from '~/api/routes/response';

const getPassageById = async (req: Request, res: Response) => {
  const { passageId } = req.params;
  const passage = await PassageService.getById(passageId, req.userId!);
  return successResponse(res, { passage });
};

export default {
  getPassageById
};
