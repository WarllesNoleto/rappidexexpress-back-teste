import {
  Controller,
  Get,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';

import { JwtAuthGuard } from '../authenticator/guards/jwt-auth.guard';
import { User } from '../shared/decorators';
import { UserRequest } from '../shared/interfaces';
import { onlyForAdmin } from '../shared/utils/permissions.function';
import { FinancialSettlementQueryDto } from './dto';
import { FinancialSettlementService } from './financial-settlement.service';

@Controller('financial-settlement')
export class FinancialSettlementController {
  constructor(
    private readonly financialSettlementService: FinancialSettlementService,
  ) {}

  @Get('pdf')
  @UseGuards(JwtAuthGuard)
  async downloadPdf(
    @User() user: UserRequest,
    @Query() query: FinancialSettlementQueryDto,
    @Res() response: Response,
  ) {
    this.ensureAdmin(user);
    const pdf = await this.financialSettlementService.generatePdf(query);

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${pdf.filename}"`,
    );
    response.send(pdf.buffer);
  }

  @Post('send-whatsapp')
  @UseGuards(JwtAuthGuard)
  async sendWhatsapp(
    @User() user: UserRequest,
    @Query() query: FinancialSettlementQueryDto,
  ) {
    this.ensureAdmin(user);
    return this.financialSettlementService.sendWhatsapp(query);
  }

  private ensureAdmin(user: UserRequest) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }
  }
}
