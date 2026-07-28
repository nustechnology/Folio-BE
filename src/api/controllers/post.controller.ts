import { Request, Response } from 'express';

import PostService from '../services/post.service.js';
import { successResponse } from '../routes/response.js';

const getUserPosts = async (req: Request, res: Response) => {
  const posts = await PostService.getUserPosts(req.userId!);

  return successResponse(res, { posts });
};

const createPost = async (req: Request, res: Response) => {
  const { title, content } = req.body;
  const post = await PostService.createPost(req.userId!, title, content);

  return successResponse(res, { post });
};

export default {
  getUserPosts,
  createPost,
};
