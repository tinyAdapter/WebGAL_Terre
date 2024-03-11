import { ApiProperty } from '@nestjs/swagger';

export class UploadFilesDto {
  @ApiProperty({ description: 'Target directory for the uploaded files' })
  targetDirectory: string;
}

export class CreateNewFileDto {
  @ApiProperty({
    description: 'The source path where the directory will be created',
  })
  source: string;

  @ApiProperty({ description: 'Name for the new file' })
  name: string;
}

export class CreateNewFolderDto {
  @ApiProperty({
    description: 'The source path where the directory will be created',
  })
  source: string;

  @ApiProperty({ description: 'Name for the new directory' })
  name: string;
}

export class DeleteFileOrDirDto {
  @ApiProperty({
    description: 'The source path of the file or directory to be deleted',
  })
  source: string;
}

export class RenameFileDto {
  @ApiProperty({
    description: 'The source path of the file or directory to be renamed',
  })
  source: string;

  @ApiProperty({ description: 'New name for renaming the file or directory' })
  newName: string;
}
