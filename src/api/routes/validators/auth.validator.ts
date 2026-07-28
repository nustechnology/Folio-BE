import Joi from "joi";

export const signUpSchema = Joi.object({
  name: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().pattern(/^\S{3,30}$/).required(),
  email: Joi.string().email().required(),
})

export const loginSchema = Joi.object({
  password: Joi.string().pattern(/^\S{3,30}$/).required(),
  email: Joi.string().email().required(),
})
