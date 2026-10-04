import {
  Body, Controller, Get, Headers, HttpException, Param, Post, Put, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ToursService } from './tours.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission, TripAccessGuard } from '../permissions/trip-access.guard';
import { AddonGuard } from '../addons/addon.guard';
import { RequireAddon } from '../addons/require-addon.decorator';
import { ADDON_IDS } from '../../addons';
import { TourCreateDto } from './dto/tour-create.dto';

const UPLOAD = { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } };

/**
 * /api/trips/:tripId/tours: the Tours facet, read and tours-mode GPX import.
 * TripAccessGuard resolves
 * :tripId (404 for no access); writes require 'place_edit'. Assignments stay
 * on the existing day_edit endpoints.
 */
@Controller('api/trips/:tripId/tours')
@UseGuards(AddonGuard, JwtAuthGuard, TripAccessGuard)
@RequireAddon(ADDON_IDS.TOURS, 'Tours')
export class ToursController {
  constructor(private readonly tours: ToursService) {}

  @Get()
  list(@Param('tripId') tripId: string) {
    return { tours: this.tours.listTours(tripId) };
  }

  @Get(':placeId')
  detail(@Param('tripId') tripId: string, @Param('placeId') placeId: string) {
    return this.tours.getTour(tripId, placeId);
  }

  @RequirePermission('place_edit')
  @Post()
  create(
    @Param('tripId') tripId: string,
    @Body() body: TourCreateDto,
    @Headers('x-socket-id') socketId?: string,
  ) {
    return this.tours.createTour(tripId, body, socketId);
  }

  @RequirePermission('place_edit')
  @Put(':placeId')
  update(
    @Param('tripId') tripId: string,
    @Param('placeId') placeId: string,
    @Body() body: TourCreateDto,
    @Headers('x-socket-id') socketId?: string,
  ) {
    return this.tours.updateTour(tripId, placeId, body, socketId);
  }

  @RequirePermission('place_edit')
  @Post('import/gpx')
  @UseInterceptors(FileInterceptor('file', UPLOAD))
  importGpx(
    @Param('tripId') tripId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers('x-socket-id') socketId?: string,
  ) {
    if (!file) {
      throw new HttpException({ error: 'No file uploaded' }, 400);
    }
    const result = this.tours.importGpxAsTour(tripId, file.buffer, file.originalname, socketId);
    if (!result) {
      throw new HttpException({ error: 'No track or route found in GPX file' }, 400);
    }
    return result;
  }
}
