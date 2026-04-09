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
