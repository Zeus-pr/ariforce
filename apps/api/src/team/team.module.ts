import { Module } from '@nestjs/common';
import { KpisModule } from '../kpis/kpis.module';
import { TeamProfileController } from './team-profile.controller';
import { TeamProfileService } from './team-profile.service';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';
import { TeamController } from './team.controller';
import { InviteMailer, TeamService } from './team.service';

@Module({
  imports: [KpisModule],
  controllers: [TeamProfileController, TeamController, SignupController],
  providers: [TeamService, InviteMailer, SignupService, TeamProfileService],
  exports: [TeamService],
})
export class TeamModule {}
