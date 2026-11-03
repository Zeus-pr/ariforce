import { HttpException, Injectable } from '@nestjs/common';
import { authContextWrite } from '../auth/auth-context-cache';
import type { TerritoryLinkImportRequest } from '@ariforce/contracts';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { MASTERS } from './master-defs';
import { MastersService } from './masters.service';
import { runTerritoryLinks } from './territory-links';

/** POST /v1/imports/territory-links: company-wide roles only (creates territories, links masters). */
@Injectable()
export class TerritoryLinksService {
  constructor(
    private readonly tenant: TenantService,
    private readonly masters: MastersService,
    private readonly audit: AuditService,
  ) {}

  run(p: Principal, req: TerritoryLinkImportRequest) {
    this.masters.assertCanWrite(MASTERS.territories!, p);
    this.masters.assertCanWrite(MASTERS.doctors!, p);
    if (req.fileKey && !req.fileKey.startsWith(`${p.companyId}/import_source/`))
      throw new HttpException(
        { code: 'VALIDATION', message: 'fileKey must come from an import_source upload' },
        422,
      );
    return authContextWrite(
      p.companyId,
      this.tenant.run(p, async (tx) => {
        const out = await runTerritoryLinks(tx, req, p.companyId, (action, e) =>
          this.audit.record(tx, p, action, e),
        );
        if (req.dryRun)
          await this.audit.record(tx, p, 'territory_links.dry_run', {
            entityType: 'territory_link_import',
            after: { totals: out.totals, fileName: req.fileName ?? null },
          });
        return out;
      }),
    );
  }
}
