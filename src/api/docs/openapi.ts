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
      name: 'Notes',
      description:
        'Private notes inside a research space. Notes are working material, not evidence sources: their content is never used as AI chat retrieval context unless explicitly converted into a source.'
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
    '/api/v1/spaces/{spaceId}/notes': {
      post: {
        tags: ['Notes'],
        summary: 'Create a note',
        description:
          'Creates a user-created note in a space owned by the authenticated user. Rich-text content is sanitized to the formatting the editor supports (bold, italic, lists, links); the 20,000-character limit is measured against the plain-text projection of that content, while the raw HTML payload itself is capped at 200,000 characters. An empty or whitespace-only title is stored as "Untitled Note".',
        operationId: 'createNote',
        security: [
          {
            bearerAuth: []
          }
        ],
        parameters: [
          {
            $ref: '#/components/parameters/SpaceIdPath'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CreateNoteRequest'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Note created successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/NoteSuccessResponse'
                }
              }
            }
          },
          '400': {
            description:
              'Validation error: title > 150 chars, empty content (code: NOTE_CONTENT_EMPTY), or plain-text content > 20,000 chars (code: NOTE_CONTENT_TOO_LONG)',
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
            $ref: '#/components/responses/SpaceNotFound'
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      },
      get: {
        tags: ['Notes'],
        summary: 'List notes in a space',
        description:
          'Returns notes in a space owned by the authenticated user. List items carry a short plain-text excerpt (`contentPreview`) instead of the full content — read a single note to get its markup.',
        operationId: 'listNotes',
        security: [
          {
            bearerAuth: []
          }
        ],
        parameters: [
          {
            $ref: '#/components/parameters/SpaceIdPath'
          },
          {
            name: 'search',
            in: 'query',
            required: false,
            description: 'Filter by note title or content (case-insensitive)',
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
              'Number of notes to return per page (default: 10, max: 100)',
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
            description: 'List of notes',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ListNotesSuccessResponse'
                }
              }
            }
          },
          '400': {
            description: 'Validation error (invalid space id, sort, or paging)',
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
            $ref: '#/components/responses/SpaceNotFound'
          },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    },
    '/api/v1/spaces/{spaceId}/notes/{noteId}': {
      get: {
        tags: ['Notes'],
        summary: 'Read a note',
        description:
          'Returns a single note with its full sanitized rich-text content.',
        operationId: 'getNote',
        security: [
          {
            bearerAuth: []
          }
        ],
        parameters: [
          {
            $ref: '#/components/parameters/SpaceIdPath'
          },
          {
            name: 'noteId',
            in: 'path',
            required: true,
            description: 'Note ID',
            schema: {
              type: 'string',
              format: 'uuid'
            }
          }
        ],
        responses: {
          '200': {
            description: 'Note found',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/NoteSuccessResponse'
                }
              }
            }
          },
          '400': {
            description: 'Validation error (space id or note id is not a UUID)',
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
            description:
              'Space not found (code: SPACE_NOT_FOUND) or note not found in that space (code: NOTE_NOT_FOUND)',
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
    parameters: {
      SpaceIdPath: {
        name: 'spaceId',
        in: 'path',
        required: true,
        description: 'Research space ID',
        schema: {
          type: 'string',
          format: 'uuid'
        }
      }
    },
    responses: {
      SpaceNotFound: {
        description:
          'The space does not exist or is not owned by the authenticated user (code: SPACE_NOT_FOUND)',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ErrorResponse'
            }
          }
        }
      },
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
      NoteBase: {
        type: 'object',
        required: [
          'id',
          'researchSpaceId',
          'title',
          'originType',
          'createdAt',
          'updatedAt',
          'citationCount'
        ],
        properties: {
          id: {
            type: 'string',
            format: 'uuid'
          },
          researchSpaceId: {
            type: 'string',
            format: 'uuid'
          },
          title: {
            type: 'string',
            description:
              'Note title. "Untitled Note" when saved without a title.',
            example: 'Key findings on transformer scaling'
          },
          originType: {
            type: 'string',
            enum: ['UserCreated', 'SavedAssistantAnswer'],
            description:
              'How the note came to exist: created by the user, or saved from an assistant answer.'
          },
          originConversationId: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Conversation the answer was saved from, if any.'
          },
          originMessageId: {
            type: 'string',
            nullable: true,
            description: 'Message the answer was saved from, if any.'
          },
          createdAt: {
            type: 'string',
            format: 'date-time'
          },
          updatedAt: {
            type: 'string',
            format: 'date-time'
          },
          citationCount: {
            type: 'integer',
            description: 'Number of citations referenced by this note',
            example: 3
          }
        }
      },
      Note: {
        allOf: [
          {
            $ref: '#/components/schemas/NoteBase'
          },
          {
            type: 'object',
            required: ['content'],
            properties: {
              content: {
                type: 'string',
                description: 'Sanitized rich-text content (HTML)',
                example: '<p>Scaling laws hold across <strong>three</strong> orders of magnitude.</p>'
              }
            }
          }
        ]
      },
      NoteSummary: {
        allOf: [
          {
            $ref: '#/components/schemas/NoteBase'
          },
          {
            type: 'object',
            required: ['contentPreview'],
            properties: {
              contentPreview: {
                type: 'string',
                description:
                  'Single-line plain-text excerpt of the content (max 280 characters)',
                example:
                  'Scaling laws hold across three orders of magnitude.'
              }
            }
          }
        ]
      },
      CreateNoteRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['content'],
        properties: {
          title: {
            type: 'string',
            maxLength: 150,
            description:
              'Note title (optional, max 150 characters). Empty or whitespace-only defaults to "Untitled Note".',
            example: 'Key findings on transformer scaling'
          },
          content: {
            type: 'string',
            maxLength: 200000,
            description:
              'Rich-text content (HTML). Sanitized on save; its plain-text projection must be 1-20,000 characters and the raw HTML must not exceed 200,000 characters.',
            example: '<p>Scaling laws hold across <strong>three</strong> orders of magnitude.</p>'
          }
        }
      },
      NoteSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['note'],
            properties: {
              note: {
                $ref: '#/components/schemas/Note'
              }
            }
          }
        }
      },
      ListNotesSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['notes', 'pagination'],
            properties: {
              notes: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/NoteSummary'
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
                    example: 24
                  },
                  totalPages: {
                    type: 'integer',
                    example: 3
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
              'SPACE_NAME_EXISTS',
              'SPACE_NOT_FOUND',
              'NOTE_NOT_FOUND',
              'NOTE_CONTENT_EMPTY',
              'NOTE_CONTENT_TOO_LONG',
              'INTERNAL_ERROR'
            ],
            nullable: true
          }
        }
      }
    }
  }
} as const;
