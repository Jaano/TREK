import { createZodDto } from 'nestjs-zod';
import { tourCreateRequestSchema } from '@trek/shared';

export class TourCreateDto extends createZodDto(tourCreateRequestSchema) {}