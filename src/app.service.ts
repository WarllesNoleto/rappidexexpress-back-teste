import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInitialRoute(): string {
    return 'API - Delivery Manager';
  }
}
