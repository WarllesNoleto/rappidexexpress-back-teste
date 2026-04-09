import { IsOptional, IsString } from 'class-validator';

export class ConfigsDto {
  @IsString()
  @IsOptional()
  amountDeliverys: string;

  @IsString()
  @IsOptional()
  blockDeliverys: string;
}
