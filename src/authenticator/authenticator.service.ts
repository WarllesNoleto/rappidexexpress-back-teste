import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import { UserEntity } from 'src/database/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthenticatorService {
  constructor(
    private jwtService: JwtService,
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
  ) {}

  generateJwt(payload) {
    return this.jwtService.sign(payload);
  }

  async signIn(data: LoginDto): Promise<Record<string, string>> {
    const userExists = await this.userRepository.findOneBy({ user: data.user });

    if (!userExists) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    const isMatch = await bcrypt.compare(data.password, userExists.password);
    if (!isMatch) {
      throw new BadRequestException('Senha errada.');
    }

    const token = this.generateJwt({
      id: userExists.id,
      phone: userExists.phone,
      user: userExists.user,
      type: userExists.type,
      permission: userExists.permission,
      cityId: userExists.cityId,
    });

    userExists.token = token;

    try {
      await this.userRepository.save(userExists);
    } catch (error) {
      throw new BadRequestException(
        'Erro com o banco de dados. Entre em contato com o suporte.',
      );
    }

    return { token, permission: userExists.type };
  }

  async changePassword(userId: string, data: ChangePasswordDto) {
    const userExists = await this.userRepository.findOneBy({ id: userId });

    if (!userExists) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    const isMatch = await bcrypt.compare(data.oldPassword, userExists.password);
    if (!isMatch) {
      throw new BadRequestException('Senha antiga está errada.');
    }

    const salt = await bcrypt.genSalt();
    const passHash = await bcrypt.hash(data.newPassword, salt);

    userExists.password = passHash;

    return await this.userRepository.save(userExists);
  }
}
