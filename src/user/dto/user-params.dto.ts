import { IsString } from 'class-validator';

export class UserParamsDto {
  @IsString()
  user: string;
}
