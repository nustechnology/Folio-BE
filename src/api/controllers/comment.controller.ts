import { Request, Response } from 'express';

import CommentService from '../services/comment.service.js';
import { successResponse } from '../routes/response.js';

const getUserComments = async (req: Request, res: Response) => {
  const comments = await CommentService.getUserComments(req.userId!);

  return successResponse(res, { comments });
};

const createComment = async (req: Request, res: Response) => {
  const { content, postId } = req.body;
  const comment = await CommentService.createComment(
    req.userId!,
    postId,
    content
  );

  return successResponse(res, { comment });
};

export default {
  getUserComments,
  createComment,
};
