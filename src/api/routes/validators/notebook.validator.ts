import Joi from 'joi';

import { NOTEBOOK } from '~/api/utils/constants';

/**
 * Empty content is accepted on purpose — clearing a notebook is a legitimate
 * edit, unlike clearing a note. The cap here is on the markup; the
 * user-facing limit is measured against the sanitized plain text in the
 * service, so tags a client pads with cannot buy room under it.
 */
export const saveNotebookSchema = Joi.object({
  content: Joi.string()
    .allow('')
    .max(NOTEBOOK.CONTENT_HTML_MAX_LENGTH)
    .required()
    .messages({
      'any.required': 'Content is required',
      'string.max': 'Content exceeds the maximum allowed size'
    })
});
