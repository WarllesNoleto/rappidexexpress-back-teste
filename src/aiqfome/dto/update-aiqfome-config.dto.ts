import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateAiqfomeConfigDto {
  @IsOptional()
  @IsBoolean()
  aiqfomeEnabled?: boolean;

  @IsOptional()
  @IsString()
  aiqfomeStoreId?: string;
}
