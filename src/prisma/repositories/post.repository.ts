import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { env } from '../../config/enviroment.js';

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const getUserPosts = async (userId: number) => {
  const posts = await prisma.post.findMany({
    where: { authorId: userId },
    include: {
      comments: true,
    },
  });

  return posts;
}

const findOne = async (id: number) => {
  const record = await prisma.post.findFirstOrThrow({
    where: { id },
    include: {
      comments: true,
    },
  });

  return record;
}

const create = async (payload: Prisma.PostUncheckedCreateInput) => {
  const record = await prisma.post.create({
    data: payload,
  });

  return record;
}

const update = async (id: number, payload: Prisma.PostUncheckedUpdateInput) => {
  const record = await prisma.post.update({
    where: { id },
    data: payload,
  });

  return record;
}

const deleteOne = async (id: number) => {
  const record = await prisma.post.delete({
    where: { id },
  });

  return record;
}

export default {
  getUserPosts,
  create,
  update,
  deleteOne
}
