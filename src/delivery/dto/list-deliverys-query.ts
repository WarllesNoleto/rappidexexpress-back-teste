import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class ListDeliveriesQueryDTO {
  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  establishmentId?: string;

  @IsString()
  @IsOptional()
  motoboyId?: string;

  @IsString()
  @IsOptional()
  createdBy?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean = false;

  @IsString()
  @IsOptional()
  createdIn?: string;

  @IsString()
  @IsOptional()
  createdUntil?: string;

  @IsNumber()
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @IsOptional()
  itemsPerPage?: number = 100;
}
