import { IsEnum, IsOptional, IsString } from 'class-validator';
import {
  StatusDelivery,
  PaymentType,
} from '../../shared/constants/enums.constants';

export class CreateDeliveryDto {
  @IsString()
  clientName: string;

  @IsString()
  clientPhone: string;

  @IsString()
  @IsOptional()
  clientLocation?: string;

  @IsString()
  @IsOptional()
  clientAddress?: string;

  @IsString()
  @IsOptional()
  addressComplement?: string;

  @IsString()
  @IsOptional()
  addressReference?: string;

  @IsString()
  @IsOptional()
  addressNeighborhood?: string;

  @IsString()
  @IsOptional()
  addressCity?: string;

  @IsString()
  @IsOptional()
  addressState?: string;

  @IsString()
  @IsOptional()
  addressZipCode?: string;

  @IsOptional()
  addressLatitude?: number;

  @IsOptional()
  addressLongitude?: number;

  @IsString()
  @IsOptional()
  addressMapsUrl?: string;

  @IsEnum(StatusDelivery)
  status: StatusDelivery;

  @IsString()
  @IsOptional()
  establishmentId?: string;

  @IsString()
  @IsOptional()
  motoboyId?: string;

  @IsString()
  @IsOptional()
  soda?: string = 'NÂO';

  @IsString()
  @IsOptional()
  observation?: string;

  @IsString()
  value: string;

  @IsEnum(PaymentType)
  payment: PaymentType;

  @IsString()
  @IsOptional()
  ifoodOrderId?: string;

  @IsString()
  @IsOptional()
  ifoodDisplayId?: string;

  @IsString()
  @IsOptional()
  ifoodMerchantId?: string;

  @IsString()
  @IsOptional()
  ifoodMerchantName?: string;
}
