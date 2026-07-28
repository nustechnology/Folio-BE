import PostRepository from '../../prisma/repositories/post.repository.js';

const getUserPosts = async (userId: number) => {
  return PostRepository.getUserPosts(userId);
};

const createPost = async (
  userId: number,
  title: string,
  content: string
) => {
  return PostRepository.create({
    title,
    content,
    authorId: userId,
  });
};

export default {
  getUserPosts,
  createPost,
};
