import fs from 'fs';
import os from 'os';
import path from 'path';

import { Request, Response, RequestHandler } from 'express';
import multer from 'multer';
import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { MAX_FILE_SIZE_BYTES } from '~/api/utils/constants';
import { isValidFileExtension } from '~/api/utils/file.util';
import { env } from '~/config/enviroment';

// Multer file upload middleware.
//
// Files are written to a temp directory on disk (MULTER_TEMP_DIR, default OS
// tmp) rather than held in memory — important since files can be up to 50 MB.
// The middleware validates extension (fileFilter) and size (limits), then the
// source service performs deeper validation (magic-byte signature + SHA-256)
// before the file is promoted to MinIO.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = env.MULTER_TEMP_DIR
      ? path.resolve(env.MULTER_TEMP_DIR)
      : os.tmpdir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    // Unique temp name to avoid collisions; the original name is preserved in
    // file.originalname for the MinIO object key.
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    // Extension whitelist check (synchronous). Real content validation happens
    // later in source.service (verifyFileSignature) since it needs async I/O.
    if (!isValidFileExtension(file.originalname)) {
      cb(
        new AppError(
          'Unsupported file format. Please upload supported files (.pdf, .docx, .txt, .md, .pptx, .xlsx, .csv, .epub).',
          StatusCodes.BAD_REQUEST,
          ErrorCode.INVALID_FILE_EXTENSION
        )
      );
      return;
    }
    cb(null, true);
  }
});

// multer's types resolve to Express 5 request types while this app uses Express
// 4, so we bridge the gap with a cast. At runtime multer 1.x works with both.
const singleFileHandler = upload.single('file') as unknown as (
  req: Request,
  res: Response,
  cb: (error?: unknown) => void
) => void;

export const uploadSingleFile: RequestHandler = (req, res, next) => {
  singleFileHandler(req, res, (error: unknown) => {
    // Translate multer's internal errors into friendly AppErrors so the client
    // sees a 400 with a clear message instead of a generic 500.
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            'File size exceeds 50 MB limit. Please select a smaller file.',
            StatusCodes.BAD_REQUEST,
            ErrorCode.FILE_TOO_LARGE
          )
        );
        return;
      }
      next(new AppError(error.message, StatusCodes.BAD_REQUEST));
      return;
    }
    next(error);
  });
};
