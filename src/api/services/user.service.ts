import UserRepository from '~/prisma/repositories/user.repository';

const getOne = async (id: string) => {
  return UserRepository.findOne(id);
};

const update = async (
  id: string,
  payload: { name?: string; email?: string; address?: string }
) => {
  return UserRepository.update(id, payload);
};

export default {
  getOne,
  update,
};
