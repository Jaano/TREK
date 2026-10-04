import { Module } from '@nestjs/common';
import { ToursController } from './tours.controller';
import { ToursService } from './tours.service';
import { PlacesModule } from '../places/places.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AuthModule } from '../auth/auth.module';
import { AddonsModule } from '../addons/addons.module';

/**
 * Tours domain: an isolated bounded context that imports PlacesModule to reuse
 * GPX preparation and persistence through PlacesService.
 */
@Module({
  imports: [PlacesModule, PermissionsModule, AuthModule, AddonsModule],
  controllers: [ToursController],
  providers: [ToursService],
})
export class ToursModule {}
