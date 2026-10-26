import { Module } from '@nestjs/common';
import { TeamController } from './team.controller';
import { InviteMailer, TeamService } from './team.service';

@Module({ controllers: [TeamController], providers: [TeamService, InviteMailer] })
export class TeamModule {}
