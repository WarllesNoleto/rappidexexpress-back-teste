import {
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNumber,
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
}