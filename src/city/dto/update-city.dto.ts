import { IsNumber, IsOptional, IsString, Length } from 'class-validator';

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

  @IsString()
  @IsOptional()
  deliveryValue?: string;

  @IsNumber()
  @IsOptional()
  deliveryFeeValue?: number;

  @IsString()
  @IsOptional()
  pixKey?: string;

  @IsString()
  @IsOptional()
  adminWhatsapp?: string;

  @IsString()
  @IsOptional()
  whatsappPhoneNumberId?: string;

  @IsString()
  @IsOptional()
  whatsappCloudToken?: string;
}
