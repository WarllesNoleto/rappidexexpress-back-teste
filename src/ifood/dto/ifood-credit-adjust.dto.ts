import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class IfoodCreditAdjustDto {
  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  reason?: string;
}