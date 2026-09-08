import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDataDto } from './user-response.dto';

export class UserRoleAssignmentResponseDto {
  @ApiProperty({ type: Number, enum: [0], example: 0 }) code: 0;
  @ApiProperty({ type: String, enum: ['OK'], example: 'OK' }) message: 'OK';
  @ApiProperty({ type: UserResponseDataDto }) data: UserResponseDataDto;
}
