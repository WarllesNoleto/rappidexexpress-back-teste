import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthenticatorService } from './authenticator.service';
import { LoginDto } from './dto/login.dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UserRequest } from 'src/shared/interfaces';
import { User } from 'src/shared/decorators';

@Controller('auth')
export class AuthenticatorController {
  constructor(private authService: AuthenticatorService) {}

  @Post()
  @ApiOperation({
    operationId: 'Login',
    summary: 'User login',
  })
  @ApiResponse({
    status: 201,
    description: 'Login success.',
  })
  async login(@Body() data: LoginDto) {
    return this.authService.signIn(data);
  }

  @Post('/change-password')
  @ApiOperation({
    operationId: 'changePassword',
    summary: 'User change password',
  })
  @ApiResponse({
    status: 201,
    description: 'Change password success.',
  })
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @User() user: UserRequest,
    @Body() data: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, data);
  }
}
