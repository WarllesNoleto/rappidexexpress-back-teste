import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { UserType } from '../../shared/constants/enums.constants';

export class ListUserQueryDTO {
  @IsString()
  @IsOptional()
  @IsEnum(UserType)
  type?: UserType;

  @IsString()
  @IsOptional()
  isNotActive?: boolean;

  @IsNumber()
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @IsOptional()
  itemsPerPage?: number = 200;
}
