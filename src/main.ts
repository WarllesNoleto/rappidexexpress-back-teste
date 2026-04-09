import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  INestApplication,
  NestApplicationOptions,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { utilities as nestWinstonUtilities, WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { AppModule } from './app.module';

async function bootstrap() {
  const options = createNestOptions();
  const app = await NestFactory.create<INestApplication>(AppModule, options);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: (origin, callback) => {
      const localOrigins = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ];

      const envOrigins = (process.env.FRONTEND_URLS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      const isVercelPreview = origin
        ? /^https:\/\/.*\.vercel\.app$/.test(origin)
        : false;

      if (
        !origin ||
        localOrigins.includes(origin) ||
        envOrigins.includes(origin) ||
        isVercelPreview
      ) {
        return callback(null, true);
      }

      return callback(new Error(`Origin não permitida: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  setupGlobalPipes(app);
  setupSwaggerModule(app, configService);

  await app.listen(configService.get<number>('PORT') || 3000);
}

function createNestOptions(): NestApplicationOptions {
  const appName = process.env.APP_NAME || 'Rappidex Express API';

  const logger = WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          nestWinstonUtilities.format.nestLike(appName),
        ),
      }),
    ],
  });

  return { logger };
}

function setupGlobalPipes(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      validateCustomDecorators: true,
      forbidUnknownValues: true,
      forbidNonWhitelisted: true,
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
}

function setupSwaggerModule(app: INestApplication, config: ConfigService) {
  const options = new DocumentBuilder()
    .setTitle(config.get('APP_NAME') || 'Rappidex Express API')
    .setVersion(config.get('APP_VERSION') || '1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('api/swagger', app, document);
}

bootstrap();
