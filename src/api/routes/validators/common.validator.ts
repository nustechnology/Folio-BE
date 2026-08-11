import Joi from 'joi';

/**
 * Every identifier this API routes on is a database UUID. A factory rather
 * than a shared instance: Joi schemas are immutable so sharing one would be
 * safe, but a factory makes that obvious at the call site instead of relying
 * on the reader knowing Joi's semantics.
 */
const uuidField = () => Joi.string().uuid().required();

/**
 * Path-parameter schemas, shared by every space-scoped router.
 *
 * Deliberately message-free: a malformed id in the URL is a routing fault, not
 * something a user typed into a form, and Joi's default wording names the
 * offending parameter — which is what you want in a log. This is also what
 * keeps the extraction observable as a no-op, since it is byte-identical to
 * the copies it replaces.
 */
export const spaceIdParamSchema = Joi.object({ spaceId: uuidField() });

export const sourceIdParamSchema = Joi.object({ sourceId: uuidField() });

export const noteParamsSchema = Joi.object({
  spaceId: uuidField(),
  noteId: uuidField()
});

/**
 * The body-field variant. The source create forms carry the space in the
 * payload, so a failure there is a form error the user reads — hence the plain
 * wording, unlike the path schemas above. Keeping the two apart is the point:
 * routing the path schemas through this would silently rewrite the error text
 * of every space-scoped route.
 */
export const spaceIdBodyField = () =>
  uuidField().messages({
    'string.empty': 'Space is required',
    'any.required': 'Space is required',
    'string.guid': 'Invalid space'
  });
