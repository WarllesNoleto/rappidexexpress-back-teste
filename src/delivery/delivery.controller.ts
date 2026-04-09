import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { JwtAuthGuard } from '../authenticator/guards/jwt-auth.guard';
import { User } from '../shared/decorators';
import { UserRequest } from '../shared/interfaces';
import {
  onlyForAdmin,
  onlyForShopkeeperOrAdmin,
} from '../shared/utils/permissions.function';
import {
  ConfigsDto,
  CreateDeliveryDto,
  // DeliveryAmountParamsDto,
  DeliveryParamsDto,
  DeliveryResult,
  ListDeliveriesQueryDTO,
  ListDeliverysResult,
  UpdateDeliveryDto,
} from './dto';

@Controller('delivery')
export class DeliveryController {
  constructor(private deliveryService: DeliveryService) {}

  @Post()
  @ApiOperation({
    operationId: 'CreateDelivery',
    summary: 'Creates a delivery',
  })
  @ApiResponse({
    status: 201,
    description: 'The delivery resource.',
    type: DeliveryResult,
  })
  @UseGuards(JwtAuthGuard)
  async createDelivery(
    @User() user: UserRequest,
    @Body() data: CreateDeliveryDto,
  ) {
    if (!onlyForShopkeeperOrAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }
    return await this.deliveryService.createDelivery(data, user);
  }

  @Put(':deliveryId')
  @ApiOperation({
    operationId: 'UpdateDelivery',
    summary: 'Update a delivery',
  })
  @ApiResponse({
    status: 201,
    description: 'The delivery resource.',
    type: DeliveryResult,
  })
  @UseGuards(JwtAuthGuard)
  async updateDelievery(
    @Param() param: DeliveryParamsDto,
    @User() user: UserRequest,
    @Body() data: UpdateDeliveryDto,
  ) {
    return await this.deliveryService.updateDelivery(
      param.deliveryId,
      data,
      user,
    );
  }

  @Get()
  @ApiOperation({
    operationId: 'ListDelivery',
    summary: 'List all deliverys',
  })
  @ApiResponse({
    status: 201,
    description: 'The delivery resource.',
    type: ListDeliverysResult,
  })
  @UseGuards(JwtAuthGuard)
  async listDeliveries(
    @User() user: UserRequest,
    @Query() queryParams: ListDeliveriesQueryDTO,
  ) {
    return await this.deliveryService.listDeliveries(user, queryParams);
  }

  @Get('counts')
  @ApiOperation({
    operationId: 'GetDashboardDeliveryCounts',
    summary: 'Get dashboard counters for pending and assigned deliveries',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard delivery counters.',
  })
  @UseGuards(JwtAuthGuard)
  async getDashboardCounts(@User() user: UserRequest) {
    return await this.deliveryService.getDashboardCounts(user);
  }

  @Delete(':deliveryId')
  @ApiOperation({
    operationId: 'DeleteDelivery',
    summary: 'Delete one delivery',
  })
  @ApiResponse({
    status: 201,
    description: 'Delete delivery resource.',
  })
  @UseGuards(JwtAuthGuard)
  async deleteDelivery(
    @Param() param: DeliveryParamsDto,
    @User() user: UserRequest,
  ) {
    if (!onlyForShopkeeperOrAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }
    return await this.deliveryService.deleteDelivery(param.deliveryId, user);
  }

  @Put('/edit/configs')
  @ApiOperation({
    operationId: 'ConfigDelivery',
    summary: 'Configs to amount delivery for motoboys',
  })
  @ApiResponse({
    status: 201,
    description: 'Configs to amount delivery for motoboys.',
  })
  @UseGuards(JwtAuthGuard)
  async changeConfigs(@User() user: UserRequest, @Body() data: ConfigsDto) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }
    return await this.deliveryService.changeConfigs(data);
  }

  @Get('config')
  @ApiOperation({
    operationId: 'ConfigDelivery',
    summary: 'Configs to amount delivery for motoboys',
  })
  @ApiResponse({
    status: 201,
    description: 'Configs to amount delivery for motoboys.',
  })
  @UseGuards(JwtAuthGuard)
  async findConfigs(@User() user: UserRequest) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }
    return await this.deliveryService.findConfigs();
  }
}