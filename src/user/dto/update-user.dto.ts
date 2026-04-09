import {
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { UserType } from '../../shared/constants/enums.constants';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name: string;

  @IsString()
  @IsOptional()
  phone: string;

  @IsString()
  @IsOptional()
  user: string;

  @IsString()
  @IsOptional()
  pix: string;

  @IsString()
  @IsOptional()
  @IsEnum(UserType)
  type: UserType;

  @IsBoolean()
  @IsOptional()
  isActive: boolean;

  @IsString()
  @IsOptional()
  profileImage?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsObject()
  @IsOptional()
  notification?: Record<string, string>;

  @IsMongoId()
  @IsOptional()
  cityId?: string;
}
