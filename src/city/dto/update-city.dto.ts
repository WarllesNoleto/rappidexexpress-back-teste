import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateCityDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @Length(2, 2)
  state?: string;

  @IsString()
  @IsOptional()
  clientWhatsappMessage?: string;
}