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
}
