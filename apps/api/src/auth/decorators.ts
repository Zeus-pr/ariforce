import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@ariforce/contracts';
import type { Principal } from './principal';

export const IS_PUBLIC = 'ariforce:public';
export const PERMISSIONS_KEY = 'ariforce:permissions';

/** Route needs no session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route needs ALL listed permissions. */
export const RequirePermissions = (...p: Permission[]) => SetMetadata(PERMISSIONS_KEY, p);
/** Inject the resolved Principal. */
export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal =>
    ctx.switchToHttp().getRequest<{ principal: Principal }>().principal,
);
