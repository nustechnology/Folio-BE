export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Folio API',
    version: '1.0.0',
    description: 'API documentation for authentication and users.'
  },
  servers: [
    {
      url: '/',
      description: 'Current server'
    }
  ],
  tags: [
    {
      name: 'Authentication',
      description: 'Account registration and authentication'
    },
    {
      name: 'Users',
      description: 'Authenticated user operations'
    },
    {
      name: 'Spaces',
      description: 'Research space management'
    },
    {
      name: 'Sources',
      description: 'Source management within a research space'
    }
  ],
  paths: {
    '/api/v1/auth/sign-up': {
      post: {
        tags: ['Authentication'],
        summary: 'Create a user account and return tokens',
        operationId: 'signUp',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/SignUpRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Account created and logged in',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SignUpSuccessResponse'
                }
              }
            }
          },
          '400': {
            description:
              'Validation error (invalid email, short password, password mismatch)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '409': {
            description: 'Email already registered',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
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
                $ref: '#/components/schemas/LoginRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthSuccessResponse'
                }
              }
            }
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '401': {
            description:
              'Invalid email or password (code: INVALID_CREDENTIALS)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    },
    '/api/v1/auth/refresh': {
      post: {
        tags: ['Authentication'],
        summary: 'Refresh access and refresh tokens (token rotation)',
        operationId: 'refresh',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/RefreshRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'New tokens issued',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthSuccessResponse'
                }
              }
            }
          },
          '400': {
            description: 'Missing refresh token',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '401': {
            description:
              'Expired (code: TOKEN_EXPIRED) or invalid (code: TOKEN_INVALID) refresh token',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Log out and invalidate refresh token',
        operationId: 'logout',
        security: [
          {
            bearerAuth: []
          }
        ],
        responses: {
          '200': {
            description: 'Logged out successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/LogoutSuccessResponse'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    },
    '/api/v1/spaces': {
      post: {
        tags: ['Spaces'],
        summary: 'Create a research space',
        description:
          'Creates a new research space for the authenticated user. Returns the created space with source and note counts initialized to 0.',
        operationId: 'createSpace',
        security: [
          {
            bearerAuth: []
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CreateSpaceRequest'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Space created successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CreateSpaceSuccessResponse'
                }
              }
            }
          },
          '400': {
            description:
              'Validation error (empty name, name > 100 chars, objective > 500 chars)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '409': {
            description:
              'A space with this name already exists (code: SPACE_NAME_EXISTS)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      },
      get: {
        tags: ['Spaces'],
        summary: 'List research spaces',
        description:
          'Returns all non-archived spaces owned by the authenticated user, with optional search and sorting.',
        operationId: 'listSpaces',
        security: [
          {
            bearerAuth: []
          }
        ],
        parameters: [
          {
            name: 'search',
            in: 'query',
            required: false,
            description:
              'Filter by space name or research objective (case-insensitive)',
            schema: {
              type: 'string'
            }
          },
          {
            name: 'sort',
            in: 'query',
            required: false,
            description: 'Sort order',
            schema: {
              type: 'string',
              enum: [
                'recently-updated',
                'recently-created',
                'alphabetical-az',
                'alphabetical-za'
              ],
              default: 'recently-updated'
            }
          },
          {
            name: 'page',
            in: 'query',
            required: false,
            description: 'Page number (default: 1)',
            schema: {
              type: 'integer',
              minimum: 1,
              default: 1
            }
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description:
              'Number of spaces to return per page (default: 10, max: 100)',
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 10
            }
          }
        ],
        responses: {
          '200': {
            description: 'List of research spaces',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ListSpacesSuccessResponse'
                }
              }
            }
          },
          '400': {
            description: 'Validation error (invalid search or sort query)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    },
    '/api/v1/sources': {
      post: {
        tags: ['Sources'],
        summary: 'Create a source in a space',
        description:
          'Creates a File, Web, or Manual source. File sources are sent as multipart/form-data with the file in the `file` field; Web and Manual sources are sent as application/json. The target space is identified by the spaceId field.',
        operationId: 'createSource',
        security: [
          {
            bearerAuth: []
          }
        ],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                $ref: '#/components/schemas/CreateFileSourceRequest'
              },
              examples: {
                FileSource: {
                  summary: 'File source',
                  value: {
                    spaceId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
                    sourceType: 'File',
                    title: 'AI Ethics Research Paper',
                    author: 'Alice Johnson',
                    file: '(select a file to upload)'
                  }
                }
              }
            },
            'application/json': {
              schema: {
                oneOf: [
                  {
                    $ref: '#/components/schemas/CreateWebSourceRequest'
                  },
                  {
                    $ref: '#/components/schemas/CreateManualSourceRequest'
                  }
                ]
              },
              examples: {
                WebSource: {
                  summary: 'Web source',
                  value: {
                    spaceId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
                    sourceType: 'Web',
                    sourceUrl: 'https://example.com/article',
                    title: 'Example Article',
                    author: ''
                  }
                },
                ManualSource: {
                  summary: 'Manual text source',
                  value: {
                    spaceId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
                    sourceType: 'Manual',
                    title: 'My Research Notes',
                    author: 'Alice Johnson',
                    content:
                      'This is a manual source with enough content to satisfy validation.'
                  }
                }
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Source created successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SourceSuccessResponse'
                }
              }
            }
          },
          '400': {
            description:
              'Validation error (invalid URL, unsupported file, content length, or source type)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '404': {
            description: 'Space not found (code: SPACE_NOT_FOUND)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      },
      get: {
        tags: ['Sources'],
        summary: 'List sources in a space',
        description:
          'Returns all sources in a space, with optional filtering by source type and processing state.',
        operationId: 'listSources',
        security: [
          {
            bearerAuth: []
          }
        ],
        parameters: [
          {
            name: 'spaceId',
            in: 'query',
            required: true,
            schema: {
              type: 'string',
              format: 'uuid'
            }
          },
          {
            name: 'sourceType',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['File', 'Web', 'Manual']
            }
          },
          {
            name: 'processingState',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: [
                'added',
                'extracting_text',
                'indexing_evidence',
                'ready',
                'failed'
              ]
            }
          },
          {
            name: 'search',
            in: 'query',
            required: false,
            description: 'Filter by source title or author (case-insensitive)',
            schema: {
              type: 'string'
            }
          },
          {
            name: 'sort',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['recently-added', 'alphabetical-az', 'alphabetical-za'],
              default: 'recently-added'
            }
          }
        ],
        responses: {
          '200': {
            description: 'List of sources',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ListSourcesSuccessResponse'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '404': {
            description: 'Space not found (code: SPACE_NOT_FOUND)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    },
    '/api/v1/sources/{sourceId}': {
      get: {
        tags: ['Sources'],
        summary: 'Get a single source',
        operationId: 'getSource',
        security: [
          {
            bearerAuth: []
          }
        ],
        parameters: [
          {
            name: 'sourceId',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              format: 'uuid'
            }
          }
        ],
        responses: {
          '200': {
            description: 'Source found',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SourceSuccessResponse'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '404': {
            description: 'Source not found (code: SOURCE_NOT_FOUND)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      },
      delete: {
        tags: ['Sources'],
        summary: 'Delete a source',
        description:
          'Removes the source record and deletes the associated MinIO object for file sources.',
        operationId: 'deleteSource',
        security: [
          {
            bearerAuth: []
          }
        ],
        parameters: [
          {
            name: 'sourceId',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              format: 'uuid'
            }
          }
        ],
        responses: {
          '200': {
            description: 'Source deleted',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/DeleteSourceSuccessResponse'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '404': {
            description: 'Source not found (code: SOURCE_NOT_FOUND)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    },
    '/api/v1/sources/{sourceId}/retry': {
      post: {
        tags: ['Sources'],
        summary: 'Retry processing of a failed source',
        description:
          'Resets the processing state of a failed source back to added so the ingestion pipeline can re-run.',
        operationId: 'retrySource',
        security: [
          {
            bearerAuth: []
          }
        ],
        parameters: [
          {
            name: 'sourceId',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              format: 'uuid'
            }
          }
        ],
        responses: {
          '200': {
            description: 'Source reset for retry',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SourceSuccessResponse'
                }
              }
            }
          },
          '400': {
            description:
              'Source is not in failed state (code: SOURCE_NOT_FAILED)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '404': {
            description: 'Source not found (code: SOURCE_NOT_FOUND)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    },
    '/api/v1/users/{id}': {
      get: {
        tags: ['Users'],
        summary: 'Get a user',
        description:
          'Use a user ID, or use `me` to retrieve the user identified by the bearer token.',
        operationId: 'getUser',
        security: [
          {
            bearerAuth: []
          }
        ],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'User ID or `me`',
            schema: {
              type: 'string',
              example: 'me'
            }
          }
        ],
        responses: {
          '200': {
            description: 'User found',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/UserSuccessResponse'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    responses: {
      Unauthorized: {
        description:
          'Missing (code: TOKEN_MISSING), expired (code: TOKEN_EXPIRED), or invalid (code: TOKEN_INVALID) bearer token',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ErrorResponse'
            }
          }
        }
      },
      InternalError: {
        description: 'Validation, database, or application error',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ErrorResponse'
            }
          }
        }
      }
    },
    schemas: {
      SignUpRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'email', 'password', 'confirmPassword'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            example: 'alice'
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'alice@example.com'
          },
          password: {
            type: 'string',
            minLength: 4,
            description: 'Password (minimum 4 characters)',
            example: 'password123'
          },
          confirmPassword: {
            type: 'string',
            description: 'Must match the password field',
            example: 'password123'
          }
        }
      },
      LoginRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'alice@example.com'
          },
          password: {
            type: 'string',
            minLength: 4,
            example: 'password123'
          }
        }
      },
      RefreshRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['refreshToken'],
        properties: {
          refreshToken: {
            type: 'string',
            description:
              'The refresh token received from a previous login or refresh',
            example: 'eyJhbGciOiJIUzI1NiIs...'
          }
        }
      },
      User: {
        type: 'object',
        required: ['id', 'name', 'email', 'createdAt', 'lastActiveAt'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'alice@example.com'
          },
          name: {
            type: 'string',
            example: 'alice'
          },
          createdAt: {
            type: 'string',
            format: 'date-time'
          },
          lastActiveAt: {
            type: 'string',
            format: 'date-time'
          }
        }
      },

      SignUpSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['user', 'accessToken', 'refreshToken'],
            properties: {
              user: {
                $ref: '#/components/schemas/User'
              },
              accessToken: {
                type: 'string',
                description: 'JWT access token (15 minute expiry)'
              },
              refreshToken: {
                type: 'string',
                description: 'JWT refresh token (30 day expiry)'
              }
            }
          }
        }
      },
      AuthSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['accessToken', 'refreshToken'],
            properties: {
              accessToken: {
                type: 'string',
                description: 'JWT access token (15 minute expiry)'
              },
              refreshToken: {
                type: 'string',
                description: 'JWT refresh token (30 day expiry)'
              }
            }
          }
        }
      },
      LogoutSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['success'],
            properties: {
              success: {
                type: 'boolean',
                enum: [true]
              }
            }
          }
        }
      },
      Space: {
        type: 'object',
        required: [
          'id',
          'name',
          'researchObjective',
          'isArchived',
          'createdAt',
          'updatedAt',
          'sourceCount',
          'noteCount'
        ],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
          },
          name: {
            type: 'string',
            example: 'AI Ethics Research'
          },
          researchObjective: {
            type: 'string',
            example: 'Explore ethical frameworks for AI decision-making.'
          },
          isArchived: {
            type: 'boolean',
            example: false
          },
          createdAt: {
            type: 'string',
            format: 'date-time'
          },
          updatedAt: {
            type: 'string',
            format: 'date-time'
          },
          sourceCount: {
            type: 'integer',
            description: 'Number of sources in this space',
            example: 3
          },
          noteCount: {
            type: 'integer',
            description: 'Number of notes in this space',
            example: 12
          }
        }
      },
      CreateSpaceRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            description: 'Space name (required, 1-100 characters, trimmed)',
            example: 'AI Ethics Research'
          },
          researchObjective: {
            type: 'string',
            maxLength: 500,
            description: 'Research objective (optional, max 500 characters)',
            example: 'Explore ethical frameworks for AI decision-making.'
          }
        }
      },
      CreateSpaceSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['space'],
            properties: {
              space: {
                $ref: '#/components/schemas/Space'
              }
            }
          }
        }
      },
      ListSpacesSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['spaces', 'pagination'],
            properties: {
              spaces: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/Space'
                }
              },
              pagination: {
                type: 'object',
                required: ['page', 'limit', 'totalCount', 'totalPages'],
                properties: {
                  page: {
                    type: 'integer',
                    example: 1
                  },
                  limit: {
                    type: 'integer',
                    example: 10
                  },
                  totalCount: {
                    type: 'integer',
                    example: 42
                  },
                  totalPages: {
                    type: 'integer',
                    example: 5
                  }
                }
              }
            }
          }
        }
      },
      UserSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['user'],
            properties: {
              user: {
                $ref: '#/components/schemas/User'
              }
            }
          }
        }
      },

      Source: {
        type: 'object',
        required: [
          'id',
          'researchSpaceId',
          'sourceType',
          'title',
          'content',
          'processingState',
          'createdAt',
          'updatedAt'
        ],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
          },
          researchSpaceId: {
            type: 'string',
            format: 'uuid',
            example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
          },
          sourceType: {
            type: 'string',
            enum: ['File', 'Web', 'Manual']
          },
          title: {
            type: 'string',
            example: 'AI Ethics Research Paper'
          },
          author: {
            type: 'string',
            nullable: true,
            example: 'Alice Johnson'
          },
          sourceUrl: {
            type: 'string',
            nullable: true,
            description: 'MinIO object key (File) or article URL (Web)'
          },
          fileName: {
            type: 'string',
            nullable: true,
            description: 'Original uploaded filename (File sources)'
          },
          fileSize: {
            type: 'integer',
            format: 'int64',
            nullable: true,
            description: 'File size in bytes (File sources)'
          },
          fileType: {
            type: 'string',
            nullable: true,
            description: 'MIME type (File sources)'
          },
          pageCount: {
            type: 'integer',
            nullable: true,
            description: 'Extracted during ingestion'
          },
          characterCount: {
            type: 'integer',
            nullable: true,
            description: 'Extracted during ingestion'
          },
          content: {
            type: 'string',
            description: 'Extracted/manual text content'
          },
          processingState: {
            type: 'string',
            enum: [
              'added',
              'extracting_text',
              'indexing_evidence',
              'ready',
              'failed'
            ],
            description:
              'Ingestion pipeline stage. `added` = source metadata registered, `extracting_text` = file parsing/scraping in progress, `indexing_evidence` = chunking and vector indexing, `ready` = fully processed and usable, `failed` = processing failed (retryable).'
          },
          processingError: {
            type: 'string',
            nullable: true,
            description: 'Error message when processingState is failed'
          },
          createdAt: {
            type: 'string',
            format: 'date-time'
          },
          updatedAt: {
            type: 'string',
            format: 'date-time'
          }
        }
      },
      CreateFileSourceRequest: {
        type: 'object',
        description:
          'Multipart form data for creating a file source. Send the file in the `file` field together with `spaceId`, `sourceType`, and optional `title`/`author` form fields. Supported extensions: .pdf, .docx, .txt, .md, .pptx, .xlsx, .csv, .epub. Maximum file size: 50 MB.',
        properties: {
          file: {
            type: 'string',
            format: 'binary',
            description: 'The file to upload'
          },
          spaceId: {
            type: 'string',
            format: 'uuid'
          },
          sourceType: {
            type: 'string',
            enum: ['File']
          },
          title: {
            type: 'string',
            maxLength: 255
          },
          author: {
            type: 'string',
            maxLength: 100
          }
        },
        required: ['file', 'spaceId', 'sourceType']
      },
      CreateWebSourceRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['spaceId', 'sourceType', 'sourceUrl'],
        properties: {
          spaceId: {
            type: 'string',
            format: 'uuid'
          },
          sourceType: {
            type: 'string',
            enum: ['Web']
          },
          sourceUrl: {
            type: 'string',
            format: 'uri',
            description: 'Article URL (http:// or https://)'
          },
          title: {
            type: 'string',
            maxLength: 255,
            description:
              'Optional; defaults to the page <title> after processing'
          },
          author: {
            type: 'string',
            maxLength: 100,
            description: 'Optional; defaults to the domain name'
          }
        }
      },
      CreateManualSourceRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['spaceId', 'sourceType', 'content'],
        properties: {
          spaceId: {
            type: 'string',
            format: 'uuid'
          },
          sourceType: {
            type: 'string',
            enum: ['Manual']
          },
          title: {
            type: 'string',
            maxLength: 255
          },
          author: {
            type: 'string',
            maxLength: 100
          },
          content: {
            type: 'string',
            minLength: 10,
            maxLength: 50000,
            description: 'Raw text content (10-50,000 characters)'
          }
        }
      },
      SourceSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['source'],
            properties: {
              source: {
                $ref: '#/components/schemas/Source'
              }
            }
          }
        }
      },
      ListSourcesSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['sources'],
            properties: {
              sources: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/Source'
                }
              }
            }
          }
        }
      },
      DeleteSourceSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['success'],
            properties: {
              success: {
                type: 'boolean',
                enum: [true]
              }
            }
          }
        }
      },

      ErrorResponse: {
        type: 'object',
        required: ['status', 'message'],
        properties: {
          status: {
            type: 'string',
            enum: ['error']
          },
          message: {
            type: 'string'
          },
          code: {
            type: 'string',
            enum: [
              'TOKEN_MISSING',
              'TOKEN_EXPIRED',
              'TOKEN_INVALID',
              'TOKEN_REVOKED',
              'INVALID_CREDENTIALS',
              'EMAIL_EXISTS',
              'INTERNAL_ERROR'
            ],
            nullable: true
          }
        }
      }
    }
  }
} as const;
