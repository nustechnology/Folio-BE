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
      name: 'Passages',
      description: 'Source text segments and passages operations'
    },
    {
      name: 'Sources',
      description: 'Source management within a research space'
    },
    {
      name: 'Notes',
      description:
        'Private notes inside a research space. Notes are working material, not evidence sources: their content is never used as AI chat retrieval context unless explicitly converted into a source.'
    },
    {
      name: 'Notebook',
      description:
        "A space's single working document — the long-form report the user writes. Auto-saved, at most one per space, and like notes it is never used as AI chat retrieval context. Unlike a note, it has no path to becoming a source."
    },
    {
      name: 'Ask',
      description:
        "Grounded question answering over a space's indexed evidence. Answers are generated only from retrieved passages of sources in `ready` state, every claim carries a citation that resolves back to the exact passage, and an answer can be saved to Notes with its citations attached."
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
          '429': { $ref: '#/components/responses/TooManyRequests' },
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
          '429': { $ref: '#/components/responses/TooManyRequests' },
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
          '429': { $ref: '#/components/responses/TooManyRequests' },
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
          '429': { $ref: '#/components/responses/TooManyRequests' },
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
          '429': { $ref: '#/components/responses/TooManyRequests' },
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
    '/api/v1/spaces/{spaceId}': {
      get: {
        tags: ['Spaces'],
        summary: 'Get a single research space',
        description:
          "Returns one space owned by the authenticated user, with its source and note counts. Used for in-space breadcrumbs and the sidebar's space block.",
        operationId: 'getSpace',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/SpaceIdPath' }],
        responses: {
          '200': {
            description: 'Space detail',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CreateSpaceSuccessResponse'
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/SpaceNotFound' },
          '500': { $ref: '#/components/responses/InternalError' }
        }
      },
      delete: {
        tags: ['Spaces'],
        summary: 'Delete a research space',
        description:
          'Permanently deletes the space together with every source, note, conversation and notebook inside it, and removes the uploaded files and extracted images from object storage. Not reversible.',
        operationId: 'deleteSpace',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/SpaceIdPath' }],
        responses: {
          '200': {
            description: 'Space deleted',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/DeleteSpaceSuccessResponse'
                }
              }
            }
          },
          '400': {
            description: 'Validation error (space id is not a UUID)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/SpaceNotFound' },
          '500': { $ref: '#/components/responses/InternalError' }
        }
      }
    },
    '/api/v1/spaces/{spaceId}/notebook': {
      get: {
        tags: ['Notebook'],
        summary: "Read a space's notebook",
        description:
          'Returns the notebook of a space owned by the authenticated user. A space whose notebook has never been saved answers `200` with empty content and null `id`/timestamps — reading never creates the notebook.',
        operationId: 'getNotebook',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/SpaceIdPath' }],
        responses: {
          '200': {
            description: 'Notebook content',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/NotebookSuccessResponse'
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/SpaceNotFound' },
          '500': { $ref: '#/components/responses/InternalError' }
        }
      },
      put: {
        tags: ['Notebook'],
        summary: "Replace a space's notebook content",
        description:
          'Creates or replaces the notebook of a space owned by the authenticated user. The whole document is sent every time, so the call is idempotent. Content is sanitized to the formatting the notebook editor supports (bold, italic, H1–H3, lists, blockquote, links); the 100,000-character limit is measured against the plain-text projection of the sanitized markup, while the raw HTML payload is capped at 1,000,000 characters. Empty content is accepted, and markup carrying no text is stored as empty. Independently of those character caps, the request body must fit the 2 MB JSON transport limit — a larger body answers 413 before validation runs.',
        operationId: 'saveNotebook',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/SpaceIdPath' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SaveNotebookRequest' }
            }
          }
        },
        responses: {
          '200': {
            description: 'Notebook saved',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/NotebookSuccessResponse'
                }
              }
            }
          },
          '400': {
            description:
              'Validation error: plain-text content > 100,000 chars (code: NOTEBOOK_CONTENT_TOO_LONG) or raw markup > 1,000,000 chars',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/SpaceNotFound' },
          '413': { $ref: '#/components/responses/PayloadTooLarge' },
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': { $ref: '#/components/responses/InternalError' }
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
              'Validation error (invalid URL, unsupported file, content length, or source type). A file over the 50 MB upload limit answers here, not 413 (code: FILE_TOO_LARGE) — multer rejects it, and the JSON transport limit never applies to multipart.',
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
          '413': { $ref: '#/components/responses/PayloadTooLarge' },
          '429': { $ref: '#/components/responses/TooManyRequests' },
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
        description:
          'Returns the source with its extracted content and, unlike the list endpoint, its indexed `passages` — the reader needs them to resolve a citation deep link (`#evidence-passage-{id}`) to the exact cited text.',
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
      patch: {
        tags: ['Sources'],
        summary: 'Update source metadata or content',
        description:
          'Updates the title, author, or content of a source. If the content of a Manual source is updated, it triggers re-extraction and re-ingestion.',
        operationId: 'updateSource',
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
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/UpdateSourceRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Source updated successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SourceSuccessResponse'
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
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    },
    '/api/v1/passages/{passageId}': {
      get: {
        tags: ['Passages'],
        summary: 'Get a single passage belonging to a source',
        operationId: 'getPassage',
        security: [
          {
            bearerAuth: []
          }
        ],
        parameters: [
          {
            name: 'passageId',
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
            description: 'Passage found',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PassageSuccessResponse'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '404': {
            description: 'Passage not found (code: PASSAGE_NOT_FOUND)',
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
    '/api/v1/sources/{sourceId}/preview': {
      get: {
        tags: ['Sources'],
        summary: 'Get preview URL or redirect to preview source',
        description:
          'Constructs a public/anonymous preview URL for the source. If requested directly via a web browser (accepting text/html) or with `redirect=true` query parameter, it redirects to the MinIO object URL directly.',
        operationId: 'getPreviewUrl',
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
          },
          {
            name: 'redirect',
            in: 'query',
            required: false,
            schema: {
              type: 'boolean'
            },
            description:
              'Set to true to force redirecting to the object URL directly instead of returning a JSON response.'
          }
        ],
        responses: {
          '200': {
            description: 'Preview URL returned',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      example: 'success'
                    },
                    data: {
                      type: 'object',
                      properties: {
                        previewUrl: {
                          type: 'string',
                          example:
                            'http://localhost:9000/folio-sources/sources/a24bc98e/paper.pdf'
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '302': {
            description: 'Redirected to MinIO object storage preview URL'
          },
          '400': {
            description: 'Invalid source type for preview',
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
            description: 'Source not found',
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
    '/api/v1/sources/{sourceId}/media/{fileName}': {
      get: {
        tags: ['Sources'],
        summary: 'Get an image extracted from a source document',
        description:
          'Streams an image that the parser pulled out of an uploaded DOCX or EPUB. The reader HTML in `structuredContent` references these by root-relative URL, so the web client resolves them against the API origin. Unauthenticated by necessity — a browser cannot attach a bearer token to an `<img>` tag — so access is gated on knowing the source UUID and the file name, which is a content hash generated at ingestion time.',
        operationId: 'getSourceMedia',
        parameters: [
          {
            name: 'sourceId',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              format: 'uuid'
            }
          },
          {
            name: 'fileName',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              pattern: '^[0-9a-f]{32}\\.[a-z0-9]{2,4}$'
            },
            description:
              'Content-addressed file name, e.g. `9f2c…a10.png`. Any other shape is rejected.'
          }
        ],
        responses: {
          '200': {
            description: 'Image stream',
            content: {
              'image/*': {
                schema: {
                  type: 'string',
                  format: 'binary'
                }
              }
            }
          },
          '400': {
            description: 'Malformed source id or file name',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '404': {
            description: 'Media not found',
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
    '/api/v1/sources/status': {
      get: {
        tags: ['Sources'],
        summary: 'Stream source processing status for all sources (SSE)',
        description:
          'Opens a Server-Sent Events stream that emits the source processing state in real time for all sources owned by the user. Immediately sends the current state for all owned sources, then streams `{sourceId, state, progress}` events as the ingestion worker advances any source through added (0%) → extracting_text (25%) → indexing_evidence (50%) → ready/failed (100%).',
        operationId: 'streamAllSourceStatus',
        security: [
          {
            bearerAuth: []
          }
        ],
        responses: {
          '200': {
            description: 'Server-Sent Events stream',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'string',
                  example:
                    'data: {"sourceId":"532a3be6-cd85-48ef-aa28-8d2ba8bb5eb0","state":"extracting_text","progress":25}\n\ndata: {"sourceId":"532a3be6-cd85-48ef-aa28-8d2ba8bb5eb0","state":"ready","progress":100}\n\n'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
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
          '429': { $ref: '#/components/responses/TooManyRequests' },
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
          '409': {
            description:
              'The answer named by `origin` has already been saved to a note (code: MESSAGE_ALREADY_SAVED)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '429': { $ref: '#/components/responses/TooManyRequests' },
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
            name: 'origin',
            in: 'query',
            required: false,
            description:
              'Filter by how the note came to exist. `all` applies no filter.',
            schema: {
              type: 'string',
              enum: ['all', 'UserCreated', 'SavedAssistantAnswer'],
              default: 'all'
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
            $ref: '#/components/parameters/NoteIdPath'
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
      },
      patch: {
        tags: ['Notes'],
        summary: 'Update a note',
        description:
          'Updates a note\'s title and/or content. At least one field is required. Content is re-sanitized and re-measured exactly as on create, and the plain-text search projection is rewritten with it. Unlike create, a title sent here cannot be blank — the "Untitled Note" fallback applies only when a note is first saved. A note\'s origin (`originType`, `originConversationId`, `originMessageId`) is not editable.',
        operationId: 'updateNote',
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
            $ref: '#/components/parameters/NoteIdPath'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/UpdateNoteRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Note updated successfully',
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
              'Validation error: empty body, blank title, title over 150 characters, empty content (code: NOTE_CONTENT_EMPTY), or content over 20,000 plain-text characters (code: NOTE_CONTENT_TOO_LONG)',
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
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      },
      delete: {
        tags: ['Notes'],
        summary: 'Delete a note',
        description:
          'Deletes a note and its citation links. Citations themselves belong to their source and are not deleted. A source that was converted from this note keeps its snapshotted content and only loses its back-reference to the note.',
        operationId: 'deleteNote',
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
            $ref: '#/components/parameters/NoteIdPath'
          }
        ],
        responses: {
          '200': {
            description: 'Note deleted successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/DeleteNoteSuccessResponse'
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
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    },
    '/api/v1/spaces/{spaceId}/notes/{noteId}/convert-to-source': {
      post: {
        tags: ['Notes'],
        summary: 'Convert a note to a source',
        description:
          "Creates a `Manual` source holding a static plain-text snapshot of the note's content, linked back to the note by `originalNoteId`, and enqueues it for ingestion. The snapshot is taken from the stored note — the request body carries no content, only an optional title override — and never re-read afterwards, so editing or deleting the note leaves the source untouched. The note itself stays excluded from AI chat retrieval; the source is the retrievable artifact. A note can be converted only once.",
        operationId: 'convertNoteToSource',
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
            $ref: '#/components/parameters/NoteIdPath'
          }
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ConvertNoteRequest'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Source created from the note and queued for ingestion',
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
              'Validation error (space id or note id is not a UUID, or the title override is over 255 characters)',
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
          '409': {
            description:
              'The note already has a source snapshot (code: NOTE_ALREADY_CONVERTED)',
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
    '/api/v1/spaces/{spaceId}/ask': {
      post: {
        tags: ['Ask'],
        summary: 'Ask a question and stream a grounded answer',
        description:
          'Answers a question from the evidence indexed in the space, streaming the reply as **Server-Sent Events** (`Content-Type: text/event-stream`).\n\nRetrieval is hybrid — vector similarity fused with Postgres full-text ranking — and only searches sources in `ready` state. The model is instructed to use nothing but the retrieved passages and to cite each claim as `[n]`; markers it invents are stripped and the survivors are renumbered, so `[n]` in `content` always indexes `citations[n-1]`.\n\nFrames, in order:\n- `start` — `{ conversationId, messageId }`, sent once generation starts. Pass `conversationId` back on the next request to continue the thread.\n- `token` — `{ text }`, one per model delta.\n- `citations` — `{ citations }`, the resolved evidence.\n- `done` — the canonical `{ messageId, content, citations, limitation, stopped }`. `content` is the post-processed answer and replaces whatever the `token` frames accumulated.\n- `error` — `{ message, code }` when generation fails after the stream opened.\n\nAborting the request (the Stop control) cancels generation, persists the partial answer, and marks it `stopped: true`. Preconditions are checked before the stream opens, so a rejected request is an ordinary JSON error response.',
        operationId: 'askQuestion',
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
                $ref: '#/components/schemas/AskRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Server-Sent Event stream of the answer',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'string',
                  example:
                    'event: start\ndata: {"conversationId":"…","messageId":"…"}\n\nevent: token\ndata: {"text":"Fragmented client records "}\n\nevent: citations\ndata: {"citations":[…]}\n\nevent: done\ndata: {"messageId":"…","content":"…","citations":[…],"limitation":null,"stopped":false}\n\n'
                }
              }
            }
          },
          '400': {
            description:
              'Validation error, or the space has no sources in `ready` state (code: NO_EVIDENCE)',
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
              'Space (code: SPACE_NOT_FOUND), source (code: SOURCE_NOT_FOUND) or conversation (code: CONVERSATION_NOT_FOUND) not found',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '409': {
            description:
              'The requested source is still being processed (code: SOURCE_NOT_READY)',
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
    '/api/v1/spaces/{spaceId}/ask/suggestions': {
      get: {
        tags: ['Ask'],
        summary: 'Starter questions for the Ask empty state',
        description:
          "Returns three suggested questions. Scoping to a single `ready` source drafts them from that document's own text (cached per source revision); every other case — whole space, a source still processing, or a model failure — returns the generic defaults with `isDynamic: false`.",
        operationId: 'getAskSuggestions',
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
            name: 'scope',
            in: 'query',
            required: false,
            description: 'Defaults to `space`.',
            schema: {
              type: 'string',
              enum: ['space', 'source'],
              default: 'space'
            }
          },
          {
            name: 'sourceId',
            in: 'query',
            required: false,
            description: 'Required when `scope=source`.',
            schema: {
              type: 'string',
              format: 'uuid'
            }
          }
        ],
        responses: {
          '200': {
            description: 'Suggested questions',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AskSuggestionsSuccessResponse'
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
    '/api/v1/spaces/{spaceId}/conversations': {
      get: {
        tags: ['Ask'],
        summary: 'List conversations in a space',
        description:
          'Chat history for one space, most recently answered first. Rows carry no messages, message count or answer preview — read a single conversation to get its thread.',
        operationId: 'listConversations',
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
            description: 'Case-insensitive substring match on the title',
            schema: {
              type: 'string'
            }
          },
          {
            name: 'page',
            in: 'query',
            required: false,
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
              'Number of conversations to return per page (default: 10, max: 100)',
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
            description: 'Conversations listed',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ListConversationsSuccessResponse'
                }
              }
            }
          },
          '400': {
            description: 'Validation error (invalid space id or paging)',
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
    '/api/v1/spaces/{spaceId}/conversations/{conversationId}': {
      get: {
        tags: ['Ask'],
        summary: 'Read a conversation',
        description:
          'Returns a conversation with its full message history, including citations, limitations, feedback ratings and whether each answer has been saved as a note.',
        operationId: 'getConversation',
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
            $ref: '#/components/parameters/ConversationIdPath'
          }
        ],
        responses: {
          '200': {
            description: 'Conversation found',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ConversationSuccessResponse'
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '404': {
            description:
              'Space (code: SPACE_NOT_FOUND) or conversation (code: CONVERSATION_NOT_FOUND) not found',
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
      patch: {
        tags: ['Ask'],
        summary: 'Rename a conversation',
        description:
          'Replaces the auto-derived title. The 60-character ceiling is the same one applied when the title is taken from the opening question.',
        operationId: 'renameConversation',
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
            $ref: '#/components/parameters/ConversationIdPath'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['title'],
                properties: {
                  title: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 60
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Conversation renamed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status', 'data'],
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['success']
                    },
                    data: {
                      type: 'object',
                      required: ['conversation'],
                      properties: {
                        conversation: {
                          $ref: '#/components/schemas/ConversationSummary'
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '400': {
            description:
              'Validation error (empty title, or longer than 60 characters)',
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
              'Space (code: SPACE_NOT_FOUND) or conversation (code: CONVERSATION_NOT_FOUND) not found',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      },
      delete: {
        tags: ['Ask'],
        summary: 'Delete a conversation',
        description:
          'Deletes the thread. Notes saved from its answers are kept — their originConversationId and originMessageId are cleared, so a saved answer can outlive the conversation it came from.',
        operationId: 'deleteConversation',
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
            $ref: '#/components/parameters/ConversationIdPath'
          }
        ],
        responses: {
          '200': {
            description: 'Conversation deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status', 'data'],
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['success']
                    },
                    data: {
                      type: 'object',
                      required: ['id'],
                      properties: {
                        id: {
                          type: 'string',
                          format: 'uuid'
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '404': {
            description:
              'Space (code: SPACE_NOT_FOUND) or conversation (code: CONVERSATION_NOT_FOUND) not found',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse'
                }
              }
            }
          },
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': {
            $ref: '#/components/responses/InternalError'
          }
        }
      }
    },
    '/api/v1/spaces/{spaceId}/conversations/{conversationId}/messages/{messageId}/feedback':
      {
        post: {
          tags: ['Ask'],
          summary: 'Rate an answer',
          description:
            'Records whether an answer was useful. Re-rating the same answer overwrites the previous rating.',
          operationId: 'recordAnswerFeedback',
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
              $ref: '#/components/parameters/ConversationIdPath'
            },
            {
              name: 'messageId',
              in: 'path',
              required: true,
              description: 'Assistant message ID',
              schema: {
                type: 'string',
                format: 'uuid'
              }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['rating'],
                  properties: {
                    rating: {
                      type: 'string',
                      enum: ['useful', 'not_useful']
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Feedback recorded',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status', 'data'],
                    properties: {
                      status: {
                        type: 'string',
                        enum: ['success']
                      },
                      data: {
                        type: 'object',
                        required: ['messageId', 'feedback'],
                        properties: {
                          messageId: {
                            type: 'string',
                            format: 'uuid'
                          },
                          feedback: {
                            type: 'string',
                            enum: ['useful', 'not_useful']
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            '401': {
              $ref: '#/components/responses/Unauthorized'
            },
            '404': {
              description:
                'Space (code: SPACE_NOT_FOUND), conversation (code: CONVERSATION_NOT_FOUND) or message (code: MESSAGE_NOT_FOUND) not found',
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
      },
      NoteIdPath: {
        name: 'noteId',
        in: 'path',
        required: true,
        description: 'Note ID',
        schema: {
          type: 'string',
          format: 'uuid'
        }
      },
      ConversationIdPath: {
        name: 'conversationId',
        in: 'path',
        required: true,
        description: 'Conversation ID',
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
      PayloadTooLarge: {
        description:
          'The request body exceeded the 2 MB transport limit and was rejected before validation ran (code: PAYLOAD_TOO_LARGE)',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ErrorResponse'
            }
          }
        }
      },
      TooManyRequests: {
        description:
          'Write rate limit exceeded — 120 requests per minute per user (code: RATE_LIMIT_EXCEEDED). The `Retry-After` and `RateLimit` headers carry the wait.',
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
            required: ['content', 'citations'],
            properties: {
              content: {
                type: 'string',
                description: 'Sanitized rich-text content (HTML)',
                example:
                  '<p>Scaling laws hold across <strong>three</strong> orders of magnitude.</p>'
              },
              citations: {
                type: 'array',
                description:
                  'Evidence this note references, in the order the answer cited it. The `[n]` markers in `content` resolve against this list by position, which is what makes them clickable in the note viewer. Empty for user-created notes.',
                items: {
                  $ref: '#/components/schemas/NoteCitation'
                }
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
                example: 'Scaling laws hold across three orders of magnitude.'
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
            example:
              '<p>Scaling laws hold across <strong>three</strong> orders of magnitude.</p>'
          },
          origin: {
            type: 'object',
            additionalProperties: false,
            required: ['conversationId', 'messageId'],
            description:
              'Set when saving a chat answer. The note is stored with `originType: SavedAssistantAnswer` and inherits the citations recorded for that answer, which are read server-side rather than taken from the request. An answer can only be saved once (code: MESSAGE_ALREADY_SAVED).',
            properties: {
              conversationId: {
                type: 'string',
                format: 'uuid'
              },
              messageId: {
                type: 'string',
                format: 'uuid'
              }
            }
          }
        }
      },
      AskRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['question'],
        properties: {
          question: {
            type: 'string',
            minLength: 1,
            maxLength: 1000,
            example: 'What problems appear most often?'
          },
          scope: {
            type: 'string',
            enum: ['space', 'source'],
            default: 'space',
            description:
              '`space` searches every `ready` source; `source` pins the answer to one document.'
          },
          sourceId: {
            type: 'string',
            format: 'uuid',
            description: 'Required when `scope=source`, rejected otherwise.'
          },
          conversationId: {
            type: 'string',
            format: 'uuid',
            description:
              'Continues an existing thread. Omit to start a new conversation.'
          }
        }
      },
      AnswerCitation: {
        type: 'object',
        required: [
          'id',
          'sourceId',
          'sourceTitle',
          'sourceType',
          'sourceAuthor',
          'sourceFileType',
          'passageId',
          'snippet',
          'locationLabel',
          'pageReference',
          'sectionReference'
        ],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description:
              'Citation record. Saving the answer as a note links this row.'
          },
          sourceId: {
            type: 'string',
            format: 'uuid'
          },
          sourceTitle: {
            type: 'string',
            example: 'Onboarding Benchmark Report'
          },
          sourceType: {
            type: 'string',
            enum: ['File', 'Web', 'Manual']
          },
          sourceAuthor: {
            type: 'string',
            nullable: true
          },
          sourceFileType: {
            type: 'string',
            nullable: true,
            description:
              'MIME type of the uploaded file, so the client can badge the citation with the real format. `null` for web and manual sources.',
            example:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          },
          passageId: {
            type: 'string',
            format: 'uuid',
            description:
              'Indexed passage the claim came from. The reader deep-links to it as `#evidence-passage-{passageId}`.'
          },
          snippet: {
            type: 'string',
            description: 'The cited passage text, verbatim.'
          },
          locationLabel: {
            type: 'string',
            nullable: true,
            description:
              'Human-readable position, derived from the page markers the extractor left in the text or the passage heading path.',
            example: 'Page 14'
          },
          pageReference: {
            type: 'string',
            nullable: true,
            example: '14'
          },
          sectionReference: {
            type: 'string',
            nullable: true,
            example: 'Methods › Sampling'
          }
        }
      },
      // Spelled out rather than composed from `AnswerCitation` with `allOf`:
      // `allOf` intersects, so a branch relaxing `passageId` to nullable cannot
      // loosen the non-nullable `passageId` the base schema requires — the
      // composed contract still rejects the `null` that `SavedCitation`
      // (`src/api/types/note.ts`) returns. Every other property is identical to
      // `AnswerCitation` by intent; they describe the same citation.
      NoteCitation: {
        type: 'object',
        description:
          'A citation as a saved note carries it. `passageId` is nullable here: rows written before the column existed have none, so the citation still shows its evidence text but cannot deep-link into the reader.',
        required: [
          'id',
          'sourceId',
          'sourceTitle',
          'sourceType',
          'sourceAuthor',
          'sourceFileType',
          'passageId',
          'snippet',
          'locationLabel',
          'pageReference',
          'sectionReference'
        ],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description:
              'Citation record. Saving the answer as a note links this row.'
          },
          sourceId: {
            type: 'string',
            format: 'uuid'
          },
          sourceTitle: {
            type: 'string',
            example: 'Onboarding Benchmark Report'
          },
          sourceType: {
            type: 'string',
            enum: ['File', 'Web', 'Manual']
          },
          sourceAuthor: {
            type: 'string',
            nullable: true
          },
          sourceFileType: {
            type: 'string',
            nullable: true,
            description:
              'MIME type of the uploaded file, so the client can badge the citation with the real format. `null` for web and manual sources.',
            example:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          },
          passageId: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description:
              'Indexed passage the claim came from, or `null` for a note saved before the column existed. The reader deep-links to it as `#evidence-passage-{passageId}`.'
          },
          snippet: {
            type: 'string',
            description: 'The cited passage text, verbatim.'
          },
          locationLabel: {
            type: 'string',
            nullable: true,
            description:
              'Human-readable position, derived from the page markers the extractor left in the text or the passage heading path.',
            example: 'Page 14'
          },
          pageReference: {
            type: 'string',
            nullable: true,
            example: '14'
          },
          sectionReference: {
            type: 'string',
            nullable: true,
            example: 'Methods › Sampling'
          }
        }
      },
      ConversationMessage: {
        type: 'object',
        required: ['id', 'role', 'content', 'createdAt'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid'
          },
          role: {
            type: 'string',
            enum: ['user', 'assistant']
          },
          content: {
            type: 'string'
          },
          citations: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/AnswerCitation'
            }
          },
          limitation: {
            type: 'string',
            nullable: true,
            description:
              'Caveat shown above the answer when the evidence is thin or one-sided.',
            example: 'Only one source contains a primary provider interview.'
          },
          feedback: {
            type: 'string',
            nullable: true,
            enum: ['useful', 'not_useful']
          },
          savedNoteId: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Set once the answer has been saved to Notes.'
          },
          stopped: {
            type: 'boolean',
            description: 'True when the user stopped generation part-way.'
          },
          createdAt: {
            type: 'string',
            format: 'date-time'
          }
        }
      },
      ConversationSummary: {
        type: 'object',
        description:
          'A history row. Deliberately carries no messages, message count or preview — all three would need the messages JSON column, which holds the entire thread.',
        required: ['id', 'title', 'createdAt', 'updatedAt'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid'
          },
          title: {
            type: 'string',
            description:
              'The opening question trimmed to 60 characters, unless renamed',
            example: 'What were the operating costs in Q4?'
          },
          createdAt: {
            type: 'string',
            format: 'date-time'
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Moves on every answered turn; the list sorts on it'
          }
        }
      },
      ListConversationsSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['conversations', 'pagination'],
            properties: {
              conversations: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/ConversationSummary'
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
                    example: 7
                  },
                  totalPages: {
                    type: 'integer',
                    example: 1
                  }
                }
              }
            }
          }
        }
      },
      ConversationSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['conversation'],
            properties: {
              conversation: {
                type: 'object',
                required: ['id', 'title', 'messages'],
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
                    type: 'string'
                  },
                  scope: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      type: {
                        type: 'string',
                        enum: ['space', 'source']
                      },
                      sourceId: {
                        type: 'string',
                        format: 'uuid'
                      }
                    }
                  },
                  messages: {
                    type: 'array',
                    items: {
                      $ref: '#/components/schemas/ConversationMessage'
                    }
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
              }
            }
          }
        }
      },
      AskSuggestionsSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['suggestions', 'isDynamic'],
            properties: {
              suggestions: {
                type: 'array',
                items: {
                  type: 'string'
                },
                example: [
                  'Summarize all the evidence.',
                  'What problems appear most often?',
                  'Where do the sources disagree?'
                ]
              },
              isDynamic: {
                type: 'boolean',
                description:
                  'True when the questions were drafted from the selected document rather than the static defaults.'
              }
            }
          }
        }
      },
      UpdateNoteRequest: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        description:
          'At least one of `title` or `content` is required. Origin fields are not editable.',
        properties: {
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 150,
            description:
              'New note title. Cannot be blank — unlike create, there is no "Untitled Note" fallback on update.',
            example: 'Transformer scaling — revised'
          },
          content: {
            type: 'string',
            maxLength: 200000,
            description:
              'New rich-text content (HTML). Sanitized and re-measured exactly as on create.',
            example: '<p>Revised: the scaling break appears at <em>7B</em>.</p>'
          }
        }
      },
      ConvertNoteRequest: {
        type: 'object',
        additionalProperties: false,
        description:
          "Optional overrides for the created source. The body may be omitted entirely. Content is never accepted here — the snapshot is taken from the stored note.",
        properties: {
          title: {
            type: 'string',
            maxLength: 255,
            description:
              "Title for the new source. Blank or omitted keeps the note's own title.",
            example: 'Transformer scaling — field notes'
          }
        }
      },
      DeleteNoteSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['deleted'],
            properties: {
              deleted: {
                type: 'boolean',
                enum: [true]
              }
            }
          }
        }
      },
      Notebook: {
        type: 'object',
        required: [
          'id',
          'researchSpaceId',
          'content',
          'createdAt',
          'updatedAt'
        ],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description:
              'Null when the notebook has never been saved — the row does not exist yet.'
          },
          researchSpaceId: {
            type: 'string',
            format: 'uuid'
          },
          content: {
            type: 'string',
            description:
              'Sanitized rich-text markup. Empty string for an unwritten notebook.',
            example:
              '<h1>Aged-Care Operations</h1><p>Providers describe duplicate entry across systems.</p>'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            nullable: true
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            nullable: true
          }
        }
      },
      SaveNotebookRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['content'],
        properties: {
          content: {
            type: 'string',
            maxLength: 1000000,
            description:
              'The whole document as rich-text markup. May be empty. Sanitized server-side; plain-text length must not exceed 100,000 characters.',
            example: '<h1>Working notebook</h1><p>First findings.</p>'
          }
        }
      },
      NotebookSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['notebook'],
            properties: {
              notebook: {
                $ref: '#/components/schemas/Notebook'
              }
            }
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

      UpdateSourceRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        description:
          '`title` is always required. `content` applies to Manual sources only; the URL and file of Web and File sources are not editable.',
        properties: {
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            description: 'New source title. Cannot be blank.',
            example: 'Attention Is All You Need — annotated'
          },
          author: {
            type: 'string',
            maxLength: 100,
            nullable: true,
            description:
              "New author. Empty string, null, or omitted stores 'Unknown Author'.",
            example: 'Vaswani et al.'
          },
          content: {
            type: 'string',
            minLength: 10,
            maxLength: 50000,
            description:
              'New body text for a Manual source. Ignored for other source types. If it differs from the stored content, existing passages are dropped and ingestion is re-enqueued.',
            example: 'Revised notes: the scaling break appears at 7B.'
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
          },
          passages: {
            type: 'array',
            description:
              'Indexed evidence passages in reading order. Returned by the detail endpoint only — a citation deep-links into the reader as `#evidence-passage-{id}`, resolved against this list. Empty until ingestion reaches `ready`.',
            items: {
              type: 'object',
              required: ['id', 'content'],
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid'
                },
                content: {
                  type: 'string'
                },
                tokenCount: {
                  type: 'integer'
                },
                locator: {
                  type: 'object',
                  description:
                    'Where the passage sits in the normalized document.',
                  properties: {
                    blockRange: {
                      type: 'array',
                      items: {
                        type: 'integer'
                      },
                      minItems: 2,
                      maxItems: 2
                    },
                    headingPath: {
                      type: 'array',
                      items: {
                        type: 'string'
                      }
                    },
                    firstOrder: {
                      type: 'integer'
                    },
                    lastOrder: {
                      type: 'integer'
                    }
                  }
                }
              }
            }
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

      Passage: {
        type: 'object',
        required: [
          'id',
          'sourceId',
          'content',
          'tokenCount',
          'strategyVersion',
          'locator',
          'createdAt'
        ],
        description:
          'A single retrievable chunk of a source. The embedding and search vectors are stored but never serialized.',
        properties: {
          id: {
            type: 'string',
            format: 'uuid'
          },
          sourceId: {
            type: 'string',
            format: 'uuid',
            description: 'The source this passage was chunked from.'
          },
          content: {
            type: 'string',
            description: 'The passage text.',
            example:
              'The Transformer follows this overall architecture using stacked self-attention...'
          },
          tokenCount: {
            type: 'integer',
            description: 'Token length of `content` at chunking time.',
            example: 412
          },
          strategyVersion: {
            type: 'string',
            description:
              'Chunking strategy that produced this passage. Passages are re-generated when it changes.',
            example: 'langchain-semantic-v1'
          },
          locator: {
            type: 'object',
            nullable: true,
            description:
              'Where the passage sits in the parsed source, used to deep-link the reader.',
            properties: {
              blockRange: {
                type: 'array',
                items: {
                  type: 'integer'
                },
                minItems: 2,
                maxItems: 2,
                description: 'Inclusive [start, end] block indices.',
                example: [12, 15]
              },
              headingPath: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Heading trail leading to the passage.',
                example: ['3. Model Architecture', '3.2 Attention']
              },
              firstOrder: {
                type: 'integer',
                example: 12
              },
              lastOrder: {
                type: 'integer',
                example: 15
              }
            }
          },
          createdAt: {
            type: 'string',
            format: 'date-time'
          }
        }
      },
      PassageSuccessResponse: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: {
            type: 'string',
            enum: ['success']
          },
          data: {
            type: 'object',
            required: ['passage'],
            properties: {
              passage: {
                $ref: '#/components/schemas/Passage'
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
      DeleteSpaceSuccessResponse: {
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
            /* The closed union from `src/api/errors/error-codes.ts`, in that
               file's order. A client generating types from this treats an
               unlisted code as invalid, so a partial list is worse than none —
               keep the two in step whenever a code is added. */
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
              'NOTE_ALREADY_CONVERTED',
              'SOURCE_NOT_FOUND',
              'SOURCE_NOT_FAILED',
              'PASSAGE_NOT_FOUND',
              'INVALID_FILE_EXTENSION',
              'INVALID_FILE_SIGNATURE',
              'FILE_TOO_LARGE',
              'FILE_UPLOAD_FAILED',
              'EMBEDDING_FAILED',
              'GENERATION_FAILED',
              'CONVERSATION_NOT_FOUND',
              'MESSAGE_NOT_FOUND',
              'MESSAGE_ALREADY_SAVED',
              'NO_EVIDENCE',
              'SOURCE_NOT_READY',
              'NOTEBOOK_CONTENT_TOO_LONG',
              'PAYLOAD_TOO_LARGE',
              'MALFORMED_JSON',
              'RATE_LIMIT_EXCEEDED',
              'INTERNAL_ERROR'
            ],
            nullable: true
          }
        }
      }
    }
  }
} as const;
