import { IsOptional, IsString, Length } from 'class-validator';

export class CreateCityDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  @Length(2, 2)
  state?: string;

  @IsString()
  @IsOptional()
  clientWhatsappMessage?: string;
}