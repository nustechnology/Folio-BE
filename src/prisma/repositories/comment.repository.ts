import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { env } from '../../config/enviroment.js';

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const getUserComments = async (userId: number) => {
  const posts = await prisma.comment.findMany({
    where: { userId },
    select: {
      id: true,
      content: true,
      post: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  return posts;
}

const create = async (payload: Prisma.CommentUncheckedCreateInput) => {
  const record = await prisma.comment.create({
    data: payload,
  });

  return record;
}

export default {
  getUserComments,
  create
}
