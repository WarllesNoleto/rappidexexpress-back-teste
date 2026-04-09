import { IsMongoId } from 'class-validator';

export class CityParamsDto {
  @IsMongoId()
  cityId: string;
}
