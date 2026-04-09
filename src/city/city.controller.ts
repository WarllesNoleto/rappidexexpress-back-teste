import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { CityService } from './city.service';
import { JwtAuthGuard } from '../authenticator/guards/jwt-auth.guard';
import { User } from '../shared/decorators';
import { UserRequest } from '../shared/interfaces';
import { onlyForSAdmin } from '../shared/utils/permissions.function';
import {
  CityParamsDto,
  CityResult,
  CreateCityDto,
  UpdateCityDto,
} from './dto';

@Controller('city')
export class CityController {
  constructor(private readonly cityService: CityService) {}

  @Get()
  @ApiOperation({
    operationId: 'ListCities',
    summary: 'Lists all cities',
  })
  @ApiResponse({
    status: 200,
    description: 'List of cities.',
    type: CityResult,
    isArray: true,
  })
  @UseGuards(JwtAuthGuard)
  async listCities(): Promise<CityResult[]> {
    return await this.cityService.listCities();
  }

  @Post()
  @ApiOperation({
    operationId: 'CreateCity',
    summary: 'Creates a city',
  })
  @ApiResponse({
    status: 201,
    description: 'City resource created.',
    type: CityResult,
  })
  @UseGuards(JwtAuthGuard)
  async createCity(
    @User() user: UserRequest,
    @Body() data: CreateCityDto,
  ): Promise<CityResult> {
    if (!onlyForSAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }

    return await this.cityService.createCity(data);
  }

  @Get(':cityId')
  @ApiOperation({
    operationId: 'ShowCity',
    summary: 'Shows a city by id',
  })
  @ApiResponse({
    status: 200,
    description: 'City resource.',
    type: CityResult,
  })
  @UseGuards(JwtAuthGuard)
  async showCity(@Param() params: CityParamsDto): Promise<CityResult> {
    return await this.cityService.findCity(params.cityId);
  }

  @Put(':cityId')
  @ApiOperation({
    operationId: 'UpdateCity',
    summary: 'Updates a city',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated city resource.',
    type: CityResult,
  })
  @UseGuards(JwtAuthGuard)
  async updateCity(
    @Param() params: CityParamsDto,
    @User() user: UserRequest,
    @Body() data: UpdateCityDto,
  ): Promise<CityResult> {
    if (!onlyForSAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }

    return await this.cityService.updateCity(params.cityId, data);
  }

  @Delete(':cityId')
  @ApiOperation({
    operationId: 'DeleteCity',
    summary: 'Deletes a city',
  })
  @ApiResponse({
    status: 200,
    description: 'City removed.',
  })
  @UseGuards(JwtAuthGuard)
  async deleteCity(
    @Param() params: CityParamsDto,
    @User() user: UserRequest,
  ): Promise<void> {
    if (!onlyForSAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }

    await this.cityService.deleteCity(params.cityId);
  }
}
