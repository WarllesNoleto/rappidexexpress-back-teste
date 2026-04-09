import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import {
  UserType,
  Permissions as UserPermissions,
} from '../../shared/constants/enums.constants';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsString()
  phone: string;

  @IsString()
  user: string;

  @IsString()
  password: string;

  @IsString()
  pix: string;

  @IsString()
  @IsOptional()
  profileImage?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsEnum(UserType)
  type: UserType;

  @IsEnum(UserPermissions)
  permission: UserPermissions;

  @IsMongoId()
  @IsOptional()
  cityId?: string;
}
