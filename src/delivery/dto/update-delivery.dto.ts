import { IsEnum, IsOptional, IsString } from 'class-validator';
import {
  StatusDelivery,
  PaymentType,
} from '../../shared/constants/enums.constants';

export class UpdateDeliveryDto {
  @IsString()
  @IsOptional()
  clientName?: string;

  @IsString()
  @IsOptional()
  clientPhone?: string;

  @IsEnum(StatusDelivery)
  @IsOptional()
  status?: StatusDelivery;

  @IsString()
  @IsOptional()
  establishmentId?: string;

  @IsString()
  @IsOptional()
  motoboyId?: string;

  @IsString()
  @IsOptional()
  value?: string;

  @IsString()
  @IsOptional()
  soda?: string;

  @IsString()
  @IsOptional()
  observation?: string;

  @IsString()
  @IsOptional()
  deliveryCode?: string;

  @IsEnum(PaymentType)
  @IsOptional()
  payment?: PaymentType;
}
