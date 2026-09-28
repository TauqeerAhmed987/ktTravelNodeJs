import { PartialType } from '@nestjs/mapped-types';
import { CreateRoomDto } from './create-room.dto.js';

export class UpdateRoomDto extends PartialType(CreateRoomDto) {}
