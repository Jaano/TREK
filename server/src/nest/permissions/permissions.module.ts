import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PermissionsService } from './permissions.service';
import { TripAccessGuard } from './trip-access.guard';
import { TripOwnerGuard } from './trip-owner.guard';
import { AppSettings } from '../../db/entities/AppSettings.entity';
import { PermissionsCacheStore, processPermissionsCache } from './permissions-cache';

/** Cross-cutting permissions domain (Wave 2). No controller/MCP surface of its
 *  own — the admin HTTP surface stays with AdminModule. Exports
 *  PermissionsService for the 17 in-container consumers and TripAccessGuard/TripOwnerGuard
 *  for every trip-scoped controller; deliberately NOT @Global so e2e TestingModules
 *  resolve it transitively through each consumer's explicit import. Registered in
 *  AppModule. MikroOrmModule.forFeature registers AppSettingsRepository for
 *  PermissionsService's @InjectRepository — the two guards keep DatabaseService's
 *  canAccessTrip (Plan 3c), unaffected by this. */
@Module({
  imports: [MikroOrmModule.forFeature([AppSettings])],
  // The cache store is the process-wide in-memory one, the same instance the
  // backup restore flushes; a shared store replaces it here.
  providers: [
    PermissionsService,
    TripAccessGuard,
    TripOwnerGuard,
    { provide: PermissionsCacheStore, useValue: processPermissionsCache },
  ],
  exports: [PermissionsService, TripAccessGuard, TripOwnerGuard],
})
export class PermissionsModule {}
