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
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { UserService } from './user.service';
import { JwtAuthGuard } from '../authenticator/guards/jwt-auth.guard';
import { User } from '../shared/decorators';
import { UserRequest } from '../shared/interfaces';
import {
  onlyForAdmin,
  onlyForMotoboyOrAdmin,
} from '../shared/utils/permissions.function';
import {
  CreateUserDto,
  ListUserQueryDTO,
  ListUsersResult,
  UpdateUserDto,
  UserParamsDto,
  UserResult,
} from './dto';

@Controller('user')
export class UserController {
  constructor(private userService: UserService) {}

  @Post()
  @ApiOperation({
    operationId: 'CreateUser',
    summary: 'Creates a user',
  })
  @ApiResponse({
    status: 201,
    description: 'The user resource.',
    type: UserResult,
  })
  @UseGuards(JwtAuthGuard)
  async createUser(@User() user: UserRequest, @Body() data: CreateUserDto) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }
    return await this.userService.createUser(data, user);
  }

  @Get()
  @ApiOperation({
    operationId: 'ListUsers',
    summary: 'Lists all users',
  })
  @ApiResponse({
    status: 200,
    description: 'List of users.',
    type: ListUsersResult,
  })
  @UseGuards(JwtAuthGuard)
  async findUsers(
    @User() user: UserRequest,
    @Query() queryParams: ListUserQueryDTO,
  ) {
    return await this.userService.listUsers(user.id, queryParams);
  }

  @Put(':user')
  @ApiOperation({
    operationId: 'UpdateUser',
    summary: 'Updates a user',
  })
  @ApiResponse({
    status: 201,
    description: 'The user resource.',
    type: UserResult,
  })
  @UseGuards(JwtAuthGuard)
  async updateUser(
    @Param() param: UserParamsDto,
    @User() user: UserRequest,
    @Body() data: UpdateUserDto,
  ) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }
    return await this.userService.updateUser(data, param.user, user);
  }

  @Get('/myself')
  @ApiOperation({
    operationId: 'GetMyself',
    summary: 'My own data',
  })
  @ApiResponse({
    status: 200,
    description: 'My own data.',
    type: ListUsersResult,
  })
  @UseGuards(JwtAuthGuard)
  async findMyself(@User() user: UserRequest) {
    return await this.userService.getMyself(user.id);
  }

  @Get('/motoboys')
  @ApiOperation({
    operationId: 'GetMotoboys',
    summary: 'Motoboys with yours deliveries',
  })
  @ApiResponse({
    status: 200,
    description: 'Motoboys with yours deliveries.',
  })
  @UseGuards(JwtAuthGuard)
  async findMotoboys(@User() user: UserRequest) {
    if (!onlyForMotoboyOrAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }
    return await this.userService.findMotoboys(user);
  }

  @Get(':user')
  @ApiOperation({
    operationId: 'GetUserByUsername',
    summary: 'My own data',
  })
  @ApiResponse({
    status: 200,
    description: 'Data for user to username.',
    type: ListUsersResult,
  })
  @UseGuards(JwtAuthGuard)
  async findUserByUsername(
    @Param() param: UserParamsDto,
    @User() user: UserRequest,
  ) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }
    return await this.userService.findUserByUsername(param.user, user);
  }

  @Put(':user/notification-config')
  @ApiOperation({
    operationId: 'UpdateUser',
    summary: 'Updates a user',
  })
  @ApiResponse({
    status: 201,
    description: 'The user resource.',
    type: UserResult,
  })
  @UseGuards(JwtAuthGuard)
  async updateUserNotification(
    @Param() param: UserParamsDto,
    @Body() data: UpdateUserDto,
    @User() user: UserRequest,
  ) {
    return await this.userService.updateUserNotification(
      data,
      param.user,
      user,
    );
  }

  @Put(':user/reset-password')
  @ApiOperation({
    operationId: 'ResetPasswordUser',
    summary: 'Reset password for user',
  })
  @ApiResponse({
    status: 201,
    description: 'The user resource.',
    type: UserResult,
  })
  @UseGuards(JwtAuthGuard)
  async resetUserPassword(
    @Param() param: UserParamsDto,
    @User() user: UserRequest,
  ) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }
    return await this.userService.resetUserPassword(param.user, user);
  }

  @Delete(':user')
  @ApiOperation({
    operationId: 'DeleteUser',
    summary: 'Delete a user',
  })
  @ApiResponse({
    status: 201,
    description: 'The user resource.',
  })
  @UseGuards(JwtAuthGuard)
  async deleteUser(@Param() param: UserParamsDto, @User() user: UserRequest) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }
    return await this.userService.deleteUser(param.user, user);
  }
}
