import { Expose, plainToClass } from 'class-transformer';
import { CityEntity } from '../../database/entities/city.entity';

export class CityResult {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  state?: string;

  @Expose()
  clientWhatsappMessage?: string;

  static fromEntity(city: CityEntity): CityResult {
    return plainToClass(CityResult, {
      id: city.id?.toHexString?.() ?? `${city.id}`,
      name: city.name,
      state: city.state,
      clientWhatsappMessage: city.clientWhatsappMessage,
    });
  }
}