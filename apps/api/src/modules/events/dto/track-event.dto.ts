import { IsString, IsUUID, IsIn, IsISO8601, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

class EventMetaDto {
  @IsIn(['search', 'recommendation', 'homepage', 'direct'])
  source: string;
}

export class TrackEventDto {
  @IsUUID()
  event_id: string;

  @IsString()
  user_id: string;

  @IsUUID()
  product_id: string;

  @IsIn(['product_view', 'product_click', 'add_to_cart', 'purchase'])
  event_type: string;

  @IsISO8601()
  timestamp: string;

  @IsObject()
  @ValidateNested()
  @Type(() => EventMetaDto)
  metadata: EventMetaDto;
}
