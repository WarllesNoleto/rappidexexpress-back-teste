import { IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  user: string;

  @IsString()
  password: string;
}
