import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  UserType,
  Permissions as UserPermissions,
} from '../../shared/constants/enums.constants';

export class CreateUserDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IfoodMerchantDto)
  ifoodMerchants?: IfoodMerchantDto[];
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

  @IsBoolean()
  @IsOptional()
  usesExternalIfoodPdv?: boolean;

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
}

class IfoodMerchantDto {
  @IsString()
  merchantId: string;
  @IsString()
  name: string;
  @IsBoolean()
  enabled: boolean;
  @IsOptional()
  @IsString()
  pickupAddress?: string;
}
