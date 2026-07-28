export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Express Prisma API',
    version: '1.0.0',
    description:
      'API documentation for authentication, users, posts, and comments.',
  },
  servers: [
    {
      url: '/',
      description: 'Current server',
    },
  ],
  tags: [
    {
      name: 'Authentication',
      description: 'Account registration and authentication',
    },
    {
      name: 'Users',
      description: 'Authenticated user operations',
    },
    {
      name: 'Posts',
      description: 'Posts owned by the authenticated user',
    },
    {
      name: 'Comments',
      description: 'Comments owned by the authenticated user',
    },
  ],
  paths: {
    '/api/v1/auth/sign-up': {
      post: {
        tags: ['Authentication'],
        summary: 'Create a user account',
        operationId: 'signUp',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/SignUpRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Account created',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/UserSuccessResponse',
                },
              },
            },
          },
          '500': {
            $ref: '#/components/responses/InternalError',
          },
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Log in with email and password',
        operationId: 'login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/LoginRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/LoginSuccessResponse',
                },
              },
            },
          },
          '500': {
            $ref: '#/components/responses/InternalError',
          },
        },
      },
    },
    '/api/v1/users/{id}': {
      get: {
        tags: ['Users'],
        summary: 'Get a user',
        description:
          'Use a numeric user ID, or use `me` to retrieve the user identified by the bearer token.',
        operationId: 'getUser',
        security: [
          {
            bearerAuth: [],
          },
        ],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Numeric user ID or `me`',
            schema: {
              type: 'string',
              pattern: '^(me|[0-9]+)$',
              example: 'me',
            },
          },
        ],
        responses: {
          '200': {
            description: 'User found',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/UserSuccessResponse',
                },
              },
            },
          },
          '401': {
            description: 'Missing or invalid bearer token',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
          '500': {
            $ref: '#/components/responses/InternalError',
          },
        },
      },
    },
    '/api/v1/posts': {
      get: {
        tags: ['Posts'],
        summary: 'List the authenticated user’s posts',
        operationId: 'getUserPosts',
        security: [
          {
            bearerAuth: [],
          },
        ],
        responses: {
          '200': {
            description: 'Posts retrieved',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PostsSuccessResponse',
                },
              },
            },
          },
          '401': {
            $ref: '#/components/responses/Unauthorized',
          },
          '500': {
            $ref: '#/components/responses/InternalError',
          },
        },
      },
      post: {
        tags: ['Posts'],
        summary: 'Create a post for the authenticated user',
        operationId: 'createPost',
        security: [
          {
            bearerAuth: [],
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CreatePostRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Post created',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PostSuccessResponse',
                },
              },
            },
          },
          '401': {
            $ref: '#/components/responses/Unauthorized',
          },
          '500': {
            $ref: '#/components/responses/InternalError',
          },
        },
      },
    },
    '/api/v1/comments': {
      get: {
        tags: ['Comments'],
        summary: 'List the authenticated user’s comments',
        operationId: 'getUserComments',
        security: [
          {
            bearerAuth: [],
          },
        ],
        responses: {
          '200': {
            description: 'Comments retrieved',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CommentsSuccessResponse',
                },
              },
            },
          },
          '401': {
            $ref: '#/components/responses/Unauthorized',
          },
          '500': {
            $ref: '#/components/responses/InternalError',
          },
        },
      },
      post: {
        tags: ['Comments'],
        summary: 'Create a comment for the authenticated user',
        operationId: 'createComment',
        security: [
          {
            bearerAuth: [],
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CreateCommentRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Comment created',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CommentSuccessResponse',
                },
              },
            },
          },
          '401': {
            $ref: '#/components/responses/Unauthorized',
          },
          '500': {
            $ref: '#/components/responses/InternalError',
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    responses: {
      Unauthorized: {
        description: 'Missing or invalid bearer token',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ErrorResponse',
            },
          },
        },
      },
      InternalError: {
        description: 'Validation, database, or application error',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ErrorResponse',
            },
          },
        },
      },
    },
    schemas: {
      SignUpRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'email', 'password'],
        properties: {
          name: {
            type: 'string',
            minLength: 3,
            maxLength: 30,
            pattern: '^[a-zA-Z0-9]+$',
            example: 'alice',
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'alice@example.com',
          },
          password: {
            type: 'string',
            minLength: 3,
            maxLength: 30,
            pattern: '^[a-zA-Z0-9]{3,30}$',
            example: 'password123',
          },
        },
      },
      LoginRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'alice@example.com',
          },
          password: {
            type: 'string',
            minLength: 3,
            maxLength: 30,
            pattern: '^[a-zA-Z0-9]{3,30}$',
            example: 'password123',
          },
        },
      },
      User: {
        type: 'object',
        required: ['id', 'email', 'createdAt', 'updatedAt'],
        properties: {
          id: {
            type: 'integer',
            format: 'int32',
            example: 1,
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'alice@example.com',
          },
          name: {
            type: 'string',
            nullable: true,
            example: 'alice',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      UserSummary: {
        type: 'object',
        required: ['id', 'email'],
        properties: {
          id: {
            type: 'integer',
            format: 'int32',
            example: 1,
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'alice@example.com',
          },
          name: {
            type: 'string',
            nullable: true,
            example: 'alice',
          },
        },
      },
      Post: {
        type: 'object',
        required: [
          'id',
          'title',
          'authorId',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          id: {
            type: 'integer',
            format: 'int32',
            example: 1,
          },
          title: {
            type: 'string',
            example: 'My first post',
          },
          content: {
            type: 'string',
            nullable: true,
            example: 'Post content',
          },
          authorId: {
            type: 'integer',
            format: 'int32',
            example: 1,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      Comment: {
        type: 'object',
        required: [
          'id',
          'content',
          'postId',
          'userId',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          id: {
            type: 'integer',
            format: 'int32',
            example: 1,
          },
          content: {
            type: 'string',
            example: 'Useful post',
          },
          postId: {
            type: 'integer',
            format: 'int32',
            example: 1,
          },
          userId: {
            type: 'integer',
            format: 'int32',
            example: 1,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      PostWithComments: {
        allOf: [
          {
            $ref: '#/components/schemas/Post',
          },
          {
            type: 'object',
            required: ['comments'],
            properties: {
              comments: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/Comment',
                },
              },
            },
          },
        ],
      },
      CommentWithRelations: {
        type: 'object',
        required: ['id', 'content', 'post', 'user'],
        properties: {
          id: {
            type: 'integer',
            format: 'int32',
            example: 1,
          },
          content: {
            type: 'string',
            example: 'Useful post',
          },
          post: {
            $ref: '#/components/schemas/Post',
          },
          user: {
            $ref: '#/components/schemas/UserSummary',
          },
        },
      },
      CreatePostRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: {
            type: 'string',
            example: 'My first post',
          },
          content: {
            type: 'string',
            nullable: true,
            example: 'Post content',
          },
        },
      },
      CreateCommentRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['content', 'postId'],
        properties: {
          content: {
            type: 'string',
            example: 'Useful post',
          },
          postId: {
            type: 'integer',
            format: 'int32',
            example: 1,
          },
        },
      },
      UserSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success'],
          },
          data: {
            type: 'object',
            required: ['user'],
            properties: {
              user: {
                $ref: '#/components/schemas/User',
              },
            },
          },
        },
      },
      LoginSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success'],
          },
          data: {
            type: 'object',
            required: ['token'],
            properties: {
              token: {
                type: 'string',
                description: 'JWT access token valid for one day',
              },
            },
          },
        },
      },
      PostsSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success'],
          },
          data: {
            type: 'object',
            required: ['posts'],
            properties: {
              posts: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/PostWithComments',
                },
              },
            },
          },
        },
      },
      PostSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success'],
          },
          data: {
            type: 'object',
            required: ['post'],
            properties: {
              post: {
                $ref: '#/components/schemas/Post',
              },
            },
          },
        },
      },
      CommentsSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success'],
          },
          data: {
            type: 'object',
            required: ['comments'],
            properties: {
              comments: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/CommentWithRelations',
                },
              },
            },
          },
        },
      },
      CommentSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success'],
          },
          data: {
            type: 'object',
            required: ['comment'],
            properties: {
              comment: {
                $ref: '#/components/schemas/Comment',
              },
            },
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['status', 'message'],
        properties: {
          status: {
            type: 'string',
            enum: ['error'],
          },
          message: {
            type: 'string',
          },
          stack: {
            type: 'string',
            description:
              'Stack trace returned only outside the production environment.',
          },
        },
      },
    },
  },
} as const;
