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
  whatsappCloudTokenMasked?: string;

  @Expose()
  hasWhatsappCloudToken?: boolean;

  private static maskToken(token?: string): string | undefined {
    const cleanToken = String(token ?? '').trim();
    if (!cleanToken) {
      return undefined;
    }

    return `${'•'.repeat(12)}${cleanToken.slice(-4)}`;
  }

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
      whatsappCloudTokenMasked: this.maskToken(city.whatsappCloudToken),
      hasWhatsappCloudToken: Boolean(city.whatsappCloudToken),
    });
  }
}
