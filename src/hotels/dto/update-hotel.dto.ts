import { PartialType } from '@nestjs/mapped-types';
import { CreateHotelDto } from './create-hotel.dto.js';

export class UpdateHotelDto extends PartialType(CreateHotelDto) {}
