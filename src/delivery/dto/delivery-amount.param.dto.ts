import { IsString } from 'class-validator';

export class DeliveryAmountParamsDto {
  @IsString()
  amount: string;
}
