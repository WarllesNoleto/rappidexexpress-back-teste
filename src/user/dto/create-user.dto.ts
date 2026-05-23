import {
  IsBoolean,
  IsDateString,
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
  
  @IsString()
  @IsOptional()
  ifoodClientId?: string;

  @IsString()
  @IsOptional()
  ifoodClientSecret?: string;

  @IsOptional()
  @IsNumber()
  ifoodOrdersReleased?: number;

  @IsOptional()
  @IsNumber()
  ifoodOrdersUsed?: number;

  @IsOptional()
  @IsNumber()
  ifoodOrdersAvailable?: number;

  @IsOptional()
  @IsBoolean()
  aiqfomeEnabled?: boolean;

  @IsOptional()
  @IsString()
  aiqfomeStoreId?: string;

  @IsOptional()
  @IsString()
  aiqfomeAccessToken?: string;

  @IsOptional()
  @IsString()
  aiqfomeRefreshToken?: string;

  @IsOptional()
  @IsDateString()
  aiqfomeTokenExpiresAt?: string;

  @IsOptional()
  @IsString()
  aiqfomeWebhookSecret?: string;
}
