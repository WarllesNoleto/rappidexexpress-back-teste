import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectId } from 'mongodb';
import { MongoRepository } from 'typeorm';

import { CityEntity } from '../database/entities/city.entity';
import { CityResult, CreateCityDto, UpdateCityDto } from './dto';

@Injectable()
export class CityService {
  constructor(
    @InjectRepository(CityEntity)
    private readonly cityRepository: MongoRepository<CityEntity>,
  ) {}

  private normalizeDeliveryFeeValue(
    value?: number | string,
  ): number | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    const normalized = String(value).includes(',')
      ? String(value).replace(/\./g, '').replace(',', '.')
      : String(value);
    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  async listCities(): Promise<CityResult[]> {
    const cities = await this.cityRepository.find({
      order: { name: 'ASC' },
    });
    return cities.map(CityResult.fromEntity);
  }

  async createCity(data: CreateCityDto): Promise<CityResult> {
    const city = await this.cityRepository.save({
      name: data.name,
      state: data.state,
      clientWhatsappMessage: data.clientWhatsappMessage?.trim() || '',
      deliveryValue: data.deliveryValue?.trim() || '',
      deliveryFeeValue: this.normalizeDeliveryFeeValue(data.deliveryFeeValue),
      pixKey: data.pixKey?.trim() || '',
      adminWhatsapp: data.adminWhatsapp?.trim() || '',
      whatsappPhoneNumberId: data.whatsappPhoneNumberId?.trim() || '',
      whatsappCloudToken: data.whatsappCloudToken?.trim() || '',
    });

    return CityResult.fromEntity(city);
  }

  async findCity(cityId: string): Promise<CityResult> {
    const city = await this.cityRepository.findOne({
      where: { _id: new ObjectId(cityId) },
    });

    if (!city) {
      throw new NotFoundException('Cidade não encontrada.');
    }

    return CityResult.fromEntity(city);
  }

  async updateCity(cityId: string, data: UpdateCityDto): Promise<CityResult> {
    const city = await this.cityRepository.findOne({
      where: { _id: new ObjectId(cityId) },
    });

    if (!city) {
      throw new NotFoundException('Cidade não encontrada.');
    }

    const updatedCity = await this.cityRepository.save({
      ...city,
      ...data,
      clientWhatsappMessage:
        data.clientWhatsappMessage !== undefined
          ? data.clientWhatsappMessage.trim()
          : city.clientWhatsappMessage,
      deliveryValue:
        data.deliveryValue !== undefined
          ? data.deliveryValue.trim()
          : city.deliveryValue,
      deliveryFeeValue:
        data.deliveryFeeValue !== undefined
          ? this.normalizeDeliveryFeeValue(data.deliveryFeeValue)
          : city.deliveryFeeValue,
      pixKey: data.pixKey !== undefined ? data.pixKey.trim() : city.pixKey,
      adminWhatsapp:
        data.adminWhatsapp !== undefined
          ? data.adminWhatsapp.trim()
          : city.adminWhatsapp,
      whatsappPhoneNumberId:
        data.whatsappPhoneNumberId !== undefined
          ? data.whatsappPhoneNumberId.trim()
          : city.whatsappPhoneNumberId,
      whatsappCloudToken:
        data.whatsappCloudToken !== undefined && data.whatsappCloudToken.trim()
          ? data.whatsappCloudToken.trim()
          : city.whatsappCloudToken,
    });

    return CityResult.fromEntity(updatedCity);
  }

  async deleteCity(cityId: string): Promise<void> {
    const city = await this.cityRepository.findOne({
      where: { _id: new ObjectId(cityId) },
    });

    if (!city) {
      throw new NotFoundException('Cidade não encontrada.');
    }

    await this.cityRepository.delete(city.id);
  }
}
