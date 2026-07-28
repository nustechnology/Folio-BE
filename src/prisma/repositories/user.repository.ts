import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { env } from '../../config/enviroment.js';

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

function exclude<User, Key extends keyof User>(
  user: User,
  keys: Key[]
): Omit<User, Key> {
  for (const key of keys) {
    delete user[key]
  }
  return user
}

const create = async (payload: Prisma.UserCreateInput) => {
  const record = await prisma.user.create({
    data: payload,
  });

  return exclude(record, ['password']);
}

const findOne = async (id: number) => {
  const record = await prisma.user.findFirstOrThrow({
    where: { id }
  });

  return exclude(record, ['password']);
}

const findOneByEmail = async (email: string, options: { excludeSensitiveFields: boolean } = { excludeSensitiveFields: true }) => {
  const record = await prisma.user.findFirst({
    where: { email }
  });

  if (!record) {
    return null;
  }

  if (options.excludeSensitiveFields) {
    return exclude(record, ['password']);
  }

  return record;
}

const update = async (id: number, payload: Prisma.UserUpdateInput) => {
  const record = await prisma.user.update({
    where: { id },
    data: payload,
  });

  return exclude(record, ['password']);
}

export default {
  create,
  findOne,
  findOneByEmail,
  update
}
