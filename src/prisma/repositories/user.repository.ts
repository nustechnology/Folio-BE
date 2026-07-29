import prisma from '~/prisma/prisma.client';
import { exclude } from '~/api/utils/exclude';
import { Prisma } from '~/generated/prisma/client';

const create = async (payload: Prisma.UserCreateInput) => {
  const record = await prisma.user.create({
    data: payload,
  });

  return exclude(record, ['password']);
};

const findById = async (id: string) => {
  const record = await prisma.user.findFirst({
    where: { id },
  });

  if (!record) {
    return null;
  }

  return record;
};

const findOne = async (id: string) => {
  const record = await prisma.user.findFirstOrThrow({
    where: { id },
  });

  return exclude(record, ['password']);
};

const findOneByEmail = async (email: string) => {
  const record = await prisma.user.findFirst({
    where: { email },
  });

  if (!record) {
    return null;
  }

  return record;
};

const update = async (id: string, payload: Prisma.UserUpdateInput) => {
  const record = await prisma.user.update({
    where: { id },
    data: payload,
  });

  return exclude(record, ['password']);
};

const updateRefreshToken = async (
  id: string,
  refreshToken: string | null,
  refreshTokenExpiresAt: Date | null,
) => {
  const record = await prisma.user.update({
    where: { id },
    data: { refreshToken, refreshTokenExpiresAt },
  });

  return exclude(record, ['password']);
};

export default {
  create,
  findById,
  findOne,
  findOneByEmail,
  update,
  updateRefreshToken,
};
