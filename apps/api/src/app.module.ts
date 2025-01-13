import { ExecutionContext, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { SkipThrottle, ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import api from '@opentelemetry/api';

import { CommonModule } from '@/common/common.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { RAGModule } from './rag/rag.module';

import configuration from './config/app.config';
import { AppController } from './app.controller';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { SkillModule } from './skill/skill.module';
import { SearchModule } from './search/search.module';
import { LabelModule } from './label/label.module';
import { EventModule } from './event/event.module';
import { MiscModule } from './misc/misc.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { StripeModule } from '@golevelup/nestjs-stripe';
import { ShareModule } from './share/share.module';
import { CanvasModule } from './canvas/canvas.module';
import { CollabModule } from './collab/collab.module';
import { ActionModule } from './action/action.module';
import { RedisService } from '@/common/redis.service';
import { APP_GUARD } from '@nestjs/core';

class CustomThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const contextType = context.getType<'http' | 'stripe_webhook'>();

    // Skip throttling for Stripe webhook endpoint
    if (contextType === 'stripe_webhook') {
      return true;
    }

    return false;
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
      cache: true,
      expandVariables: true,
    }),
    ThrottlerModule.forRootAsync({
      imports: [CommonModule],
      inject: [RedisService],
      useFactory: async (redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: seconds(1),
            limit: 10,
          },
        ],
        getTracker: (req) => (req.ips?.length ? req.ips[0] : req.ip),
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        redact: {
          paths: ['pid', 'hostname', 'req.headers'],
          remove: true,
        },
        autoLogging: false,
        genReqId: () => api.trace.getSpan(api.context.active())?.spanContext()?.traceId,
        customSuccessObject: (req) => ({
          env: process.env.NODE_ENV,
          uid: (req as any).user?.uid || 'anonymous',
        }),
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
      },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          host: configService.get('redis.host'),
          port: configService.get('redis.port'),
          password: configService.get('redis.password') || undefined,
        },
      }),
      inject: [ConfigService],
    }),
    StripeModule.forRootAsync(StripeModule, {
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        apiKey: configService.get('stripe.apiKey'),
        webhookConfig: {
          stripeSecrets: {
            account: configService.get('stripe.webhookSecret.account'),
            accountTest: configService.get('stripe.webhookSecret.accountTest'),
          },
          decorators: [SkipThrottle()],
          requestBodyProperty: 'rawBody',
        },
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UserModule,
    RAGModule,
    KnowledgeModule,
    SkillModule,
    SearchModule,
    LabelModule,
    EventModule,
    MiscModule,
    SubscriptionModule,
    ShareModule,
    CanvasModule,
    CollabModule,
    ActionModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule {}
