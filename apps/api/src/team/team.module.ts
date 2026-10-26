import { Module } from '@nestjs/common';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';
import { TeamController } from './team.controller';
import { InviteMailer, TeamService } from './team.service';

@Module({
  controllers: [TeamController, SignupController],
  providers: [TeamService, InviteMailer, SignupService],
})
export class TeamModule {}
