import { Request, Response } from 'express';

import SpaceService from '~/api/services/space.service';
import { successResponse } from '~/api/routes/response';

const list = async (req: Request, res: Response) => {
  const { search, sort } = req.query as { search?: string; sort: any };
  const spaces = await SpaceService.list(req.userId!, { search, sort });

  return successResponse(res, { spaces });
};

export default {
  list,
};
