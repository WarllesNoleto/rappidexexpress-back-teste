import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { addHours } from 'date-fns';
import { v4 as uuid } from 'uuid';
import { MongoRepository } from 'typeorm';
import {
  IfoodCreditHistoryEntity,
  UserEntity,
} from '../database/entities';
import { UserType } from '../shared/constants/enums.constants';
import { UserRequest } from '../shared/interfaces';

@Injectable()
export class IfoodCreditsService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
    @InjectRepository(IfoodCreditHistoryEntity)
    private readonly creditHistoryRepository: MongoRepository<IfoodCreditHistoryEntity>,
  ) {}

  private async findCompanyOrFail(companyId: string) {
    const company = await this.userRepository.findOneBy({ id: companyId });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    if (
      company.type !== UserType.SHOPKEEPER &&
      company.type !== UserType.SHOPKEEPERADMIN
    ) {
      throw new BadRequestException('O usuário informado não é uma empresa.');
    }

    return company;
  }

  private ensureCanManageCredits(requestUser: UserRequest) {
    if (
      requestUser.type !== UserType.ADMIN &&
      requestUser.type !== UserType.SUPERADMIN
    ) {
      throw new ForbiddenException(
        'Apenas admin ou super admin podem gerenciar créditos iFood.',
      );
    }
  }

  private ensureCompanyAccess(requestUser: UserRequest, company: UserEntity) {
    if (
      requestUser.type === UserType.ADMIN &&
      requestUser.cityId !== company.cityId
    ) {
      throw new ForbiddenException(
        'Você não tem permissão para gerenciar empresas de outra cidade.',
      );
    }
  }

  private async registerHistory(data: {
    companyId: string;
    operationType: 'ADD' | 'REMOVE' | 'CONSUME';
    amount: number;
    releasedAfterOperation: number;
    usedAfterOperation: number;
    availableAfterOperation: number;
    performedBy?: string;
    orderId?: string;
    reason?: string;
  }) {
    await this.creditHistoryRepository.save({
      ...data,
      id: uuid(),
      createdAt: addHours(new Date(), -3),
    });
  }

  async addCredits(
    companyId: string,
    amount: number,
    requestUser: UserRequest,
    reason?: string,
  ) {
    this.ensureCanManageCredits(requestUser);
    const company = await this.findCompanyOrFail(companyId);
    this.ensureCompanyAccess(requestUser, company);

    const updated = await this.userRepository.findOneAndUpdate(
      { id: companyId },
      {
        $inc: {
          ifoodOrdersReleased: amount,
          ifoodOrdersAvailable: amount,
        },
        $set: { updatedAt: addHours(new Date(), -3) },
      },
      { returnDocument: 'after' },
    );

    if (!updated.value) {
      throw new BadRequestException('Não foi possível adicionar créditos.');
    }

    await this.registerHistory({
      companyId,
      operationType: 'ADD',
      amount,
      releasedAfterOperation: updated.value.ifoodOrdersReleased || 0,
      usedAfterOperation: updated.value.ifoodOrdersUsed || 0,
      availableAfterOperation: updated.value.ifoodOrdersAvailable || 0,
      performedBy: requestUser.id,
      reason,
    });

    return this.buildSummary(updated.value);
  }

  async removeCredits(
    companyId: string,
    amount: number,
    requestUser: UserRequest,
    reason?: string,
  ) {
    this.ensureCanManageCredits(requestUser);
    const company = await this.findCompanyOrFail(companyId);
    this.ensureCompanyAccess(requestUser, company);

    const updated = await this.userRepository.findOneAndUpdate(
      {
        id: companyId,
        ifoodOrdersAvailable: { $gte: amount },
        ifoodOrdersReleased: { $gte: amount },
      },
      {
        $inc: {
          ifoodOrdersReleased: -amount,
          ifoodOrdersAvailable: -amount,
        },
        $set: { updatedAt: addHours(new Date(), -3) },
      },
      { returnDocument: 'after' },
    );

    if (!updated.value) {
      throw new BadRequestException(
        'Saldo insuficiente para remoção de créditos.',
      );
    }

    await this.registerHistory({
      companyId,
      operationType: 'REMOVE',
      amount,
      releasedAfterOperation: updated.value.ifoodOrdersReleased || 0,
      usedAfterOperation: updated.value.ifoodOrdersUsed || 0,
      availableAfterOperation: updated.value.ifoodOrdersAvailable || 0,
      performedBy: requestUser.id,
      reason,
    });

    return this.buildSummary(updated.value);
  }

  async consumeCreditForOrder(companyId: string, orderId: string) {
    const updated = await this.userRepository.findOneAndUpdate(
      {
        id: companyId,
        ifoodOrdersAvailable: { $gte: 1 },
      },
      {
        $inc: {
          ifoodOrdersAvailable: -1,
          ifoodOrdersUsed: 1,
        },
        $set: { updatedAt: addHours(new Date(), -3) },
      },
      { returnDocument: 'after' },
    );

    if (!updated.value) {
      throw new ForbiddenException(
        'Sem créditos disponíveis para criar novos pedidos.',
      );
    }

    await this.registerHistory({
      companyId,
      operationType: 'CONSUME',
      amount: 1,
      releasedAfterOperation: updated.value.ifoodOrdersReleased || 0,
      usedAfterOperation: updated.value.ifoodOrdersUsed || 0,
      availableAfterOperation: updated.value.ifoodOrdersAvailable || 0,
      orderId,
    });

    return updated.value;
  }

  buildSummary(company: UserEntity) {
    return {
      companyId: company.id,
      companyName: company.name,
      ifoodOrdersReleased: company.ifoodOrdersReleased || 0,
      ifoodOrdersUsed: company.ifoodOrdersUsed || 0,
      ifoodOrdersAvailable: company.ifoodOrdersAvailable || 0,
      useIfoodIntegration: Boolean(company.useIfoodIntegration),
      ifoodMerchantId: company.ifoodMerchantId || '',
    };
  }

  async getCompanySummary(companyId: string, requestUser: UserRequest) {
    const company = await this.findCompanyOrFail(companyId);

    if (
      requestUser.type === UserType.SHOPKEEPER ||
      requestUser.type === UserType.SHOPKEEPERADMIN
    ) {
      if (requestUser.id !== companyId) {
        throw new ForbiddenException(
          'Você só pode visualizar os dados da própria empresa.',
        );
      }
    } else {
      this.ensureCanManageCredits(requestUser);
      this.ensureCompanyAccess(requestUser, company);
    }

    return this.buildSummary(company);
  }

  async getCompanyHistory(companyId: string, requestUser: UserRequest) {
    const company = await this.findCompanyOrFail(companyId);

    if (
      requestUser.type === UserType.SHOPKEEPER ||
      requestUser.type === UserType.SHOPKEEPERADMIN
    ) {
      if (requestUser.id !== companyId) {
        throw new ForbiddenException(
          'Você só pode visualizar os dados da própria empresa.',
        );
      }
    } else {
      this.ensureCanManageCredits(requestUser);
      this.ensureCompanyAccess(requestUser, company);
    }

    const history = await this.creditHistoryRepository.find({
      where: { companyId },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return {
      summary: this.buildSummary(company),
      history,
    };
  }

  async getMySummary(requestUser: UserRequest) {
    if (
      requestUser.type !== UserType.SHOPKEEPER &&
      requestUser.type !== UserType.SHOPKEEPERADMIN
    ) {
      throw new ForbiddenException('Apenas empresas possuem esse resumo.');
    }

    const company = await this.findCompanyOrFail(requestUser.id);
    return this.buildSummary(company);
  }

  async getMyHistory(requestUser: UserRequest) {
    if (
      requestUser.type !== UserType.SHOPKEEPER &&
      requestUser.type !== UserType.SHOPKEEPERADMIN
    ) {
      throw new ForbiddenException('Apenas empresas possuem esse histórico.');
    }

    return this.getCompanyHistory(requestUser.id, requestUser);
  }

  async getCreditSummaryForIntegratedCompanies(requestUser: UserRequest) {
    this.ensureCanManageCredits(requestUser);

    const where: any = {
      useIfoodIntegration: true,
      type: { $in: [UserType.SHOPKEEPER, UserType.SHOPKEEPERADMIN] },
    };

    if (requestUser.type === UserType.ADMIN) {
      where.cityId = requestUser.cityId;
    }

    const companies = await this.userRepository.find({ where, take: 1000 });
    return companies.map((company) => this.buildSummary(company));
  }
}