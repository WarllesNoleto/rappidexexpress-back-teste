import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserType } from '../../shared/constants/enums.constants';

export class UpdateUserDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IfoodMerchantDto)
  ifoodMerchants?: IfoodMerchantDto[];
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

  @IsBoolean()
  @IsOptional()
  anotaAiEnabled?: boolean;

  @IsString()
  @IsOptional()
  anotaAiStoreId?: string;

  @IsString()
  @IsOptional()
  anotaAiClientId?: string;

  @IsString()
  @IsOptional()
  anotaAiClientSecret?: string;

  @IsString()
  @IsOptional()
  anotaAiToken?: string;

  @IsBoolean()
  @IsOptional()
  anotaAiIgnoreIfoodOrders?: boolean;

  @IsBoolean()
  @IsOptional()
  saiposEnabled?: boolean;

  @IsString()
  @IsOptional()
  saiposStoreId?: string;

  @IsString()
  @IsOptional()
  saiposMerchantId?: string;

  @IsString()
  @IsOptional()
  saiposToken?: string;
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
