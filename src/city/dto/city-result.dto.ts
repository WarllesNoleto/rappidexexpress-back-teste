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

  @Expose()
  deliveryValue?: string;

  @Expose()
  deliveryFeeValue?: number;

  @Expose()
  pixKey?: string;

  @Expose()
  adminWhatsapp?: string;

  @Expose()
  whatsappPhoneNumberId?: string;

  @Expose()
  whatsappCloudTokenConfigured?: boolean;

  static fromEntity(city: CityEntity): CityResult {
    return plainToClass(CityResult, {
      id: city.id?.toHexString?.() ?? `${city.id}`,
      name: city.name,
      state: city.state,
      clientWhatsappMessage: city.clientWhatsappMessage,
      deliveryValue: city.deliveryValue,
      deliveryFeeValue: city.deliveryFeeValue,
      pixKey: city.pixKey,
      adminWhatsapp: city.adminWhatsapp,
      whatsappPhoneNumberId: city.whatsappPhoneNumberId,
      whatsappCloudTokenConfigured: Boolean(String(city.whatsappCloudToken ?? '').trim()),
    });
  }
}
