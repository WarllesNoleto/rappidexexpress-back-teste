import { IsString } from 'class-validator';

export class DeliveryParamsDto {
  @IsString()
  deliveryId: string;
}
