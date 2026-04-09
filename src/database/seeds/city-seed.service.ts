import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { CityEntity } from '../entities/city.entity';

const DEFAULT_CITY = {
  name: 'Redenção',
  state: 'PA',
};

@Injectable()
export class CitySeedService implements OnModuleInit {
  constructor(
    @InjectRepository(CityEntity)
    private readonly cityRepository: MongoRepository<CityEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    const cityExists = await this.cityRepository.findOne({
      where: { name: DEFAULT_CITY.name, state: DEFAULT_CITY.state },
    });

    if (!cityExists) {
      await this.cityRepository.insert(DEFAULT_CITY);
    }
  }
}
