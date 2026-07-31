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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = env.MULTER_TEMP_DIR
      ? path.resolve(env.MULTER_TEMP_DIR)
      : os.tmpdir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
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

const singleFileHandler = upload.single('file') as unknown as (
  req: Request,
  res: Response,
  cb: (error?: unknown) => void
) => void;

export const uploadSingleFile: RequestHandler = (req, res, next) => {
  singleFileHandler(req, res, (error: unknown) => {
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
