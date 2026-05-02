import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { AiqfomeStoreTokenEntity } from './entities/aiqfome-store-token.entity';

@Injectable()
export class AiqfomeAuthService {
  constructor(
    @InjectRepository(AiqfomeStoreTokenEntity)
    private readonly tokenRepository: MongoRepository<AiqfomeStoreTokenEntity>,
  ) {}

  async findActiveStoreTokenByStoreId(storeId: string) {
    return this.tokenRepository.findOneBy({ storeId, isActive: true });
  }
}