import { IsString } from 'class-validator';

export class UpdateCapacityDto {
  @IsString()
  adult_child: string;
}
