declare module 'file-type' {
  export type FileTypeResult = {
    ext: string;
    mime: string;
  };
  export function fileTypeFromFile(
    filePath: string
  ): Promise<FileTypeResult | undefined>;
}
