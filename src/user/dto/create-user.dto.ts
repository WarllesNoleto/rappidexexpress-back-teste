import {
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
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

  @IsBoolean()
  @IsOptional()
  useIfoodIntegration?: boolean;

  @IsString()
  @IsOptional()
  ifoodMerchantId?: string;

  @IsOptional()
  @IsNumber()
  ifoodOrdersReleased?: number;

  @IsOptional()
  @IsNumber()
  ifoodOrdersUsed?: number;

  @IsOptional()
  @IsNumber()
  ifoodOrdersAvailable?: number;
}