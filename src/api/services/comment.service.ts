import CommentRepository from '../../prisma/repositories/comment.repository.js';

const getUserComments = async (userId: number) => {
  return CommentRepository.getUserComments(userId);
};

const createComment = async (
  userId: number,
  postId: number,
  content: string
) => {
  return CommentRepository.create({
    content,
    userId,
    postId,
  });
};

export default {
  getUserComments,
  createComment,
};
