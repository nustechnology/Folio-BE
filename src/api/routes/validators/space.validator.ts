import Joi from 'joi';

export const listSpacesQuerySchema = Joi.object({
  search: Joi.string().allow('').optional(),
  sort: Joi.string()
    .valid('recently-updated', 'recently-created', 'alphabetical-az', 'alphabetical-za')
    .default('recently-updated'),
});
