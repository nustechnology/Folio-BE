import UserRepository from "~/prisma/repositories/user.repository";
import { AppError } from "../errors/app.error";
import { StatusCodes } from "http-status-codes";
import { exclude } from "../utils/exclude";

const getOne = async (id: string) => {
  const user = await UserRepository.findOne(id);
  if (!user) {
    throw new AppError("User not found", StatusCodes.NOT_FOUND);
  }
  return exclude(user, ["refreshToken", "tokenVersion"]);
};

const update = async (
  id: string,
  payload: { name?: string; email?: string; address?: string },
) => {
  const user = await UserRepository.update(id, payload);
  return exclude(user, ["refreshToken", "tokenVersion"]);
};

export default {
  getOne,
  update,
};
