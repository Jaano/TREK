import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { AdminOidcController, OidcController } from './oidc.controller';
import { AuditModule } from '../audit/audit.module';
import { OidcService } from './oidc.service';
import { InMemoryOidcFlowStore, OidcFlowStore } from './oidc-flow.store';
import { AuthModule } from '../auth/auth.module';
import { TripMembershipModule } from '../trip-membership/trip-membership.module';
import { Users } from '../../db/entities/Users.entity';
import { InviteTokens } from '../../db/entities/InviteTokens.entity';
import { AppSettings } from '../../db/entities/AppSettings.entity';

@Module({
  imports: [AuthModule, TripMembershipModule, AuditModule, MikroOrmModule.forFeature([Users, InviteTokens, AppSettings])],
  controllers: [OidcController, AdminOidcController],
  // The login states and codes stay in this process's memory; a store shared
  // between processes would be provided here instead.
  providers: [OidcService, { provide: OidcFlowStore, useClass: InMemoryOidcFlowStore }],
})
export class OidcModule {}
