import UserRepository from '../../prisma/repositories/user.repository.js';

const getOne = async (id: number) => {
  return UserRepository.findOne(id);
};

const update = async (
  id: number,
  payload: { name?: string; email?: string; address?: string }
) => {
  return UserRepository.update(id, payload);
};

export default {
  getOne,
  update,
};
