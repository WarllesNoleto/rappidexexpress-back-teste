import { IsOptional, IsString } from 'class-validator';

export class ReleaseDeliveryDto {
  @IsOptional()
  @IsString()
  motoboyId?: string;
}
