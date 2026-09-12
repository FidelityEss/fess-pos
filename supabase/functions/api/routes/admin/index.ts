// /v1/admin/* — admin panel API. Every route: Supabase Auth session + MFA (requireStaff), then exactly one
// pos_rpc.admin_* write in asService({ id: staff.userId, role: 'pos_admin', requestId }) — see ./_util.ts.
// Bank readers pass requireStaff (allowReader) but every write route is gated with requirePermission(), which refuses them.
import { Hono } from 'hono';
import { requireStaff } from '../../../_shared/auth.ts';
import type { AppEnv } from '../../../_shared/types.ts';
import { configRoutes } from './config.ts';
import { definitionRoutes } from './definitions.ts';
import { jobRoutes } from './jobs.ts';
import { opsRoutes } from './ops.ts';
import { peopleRoutes } from './people.ts';
import { referenceRoutes } from './reference.ts';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', requireStaff({ allowReader: true }));

adminRoutes.get('/me', (c) => {
  const s = c.get('staff');
  return c.json({
    id: s.userId,
    role: s.role,
    permissions: s.permissions,
    bank_ids: s.bankIds,
    first_name: s.firstName,
    last_name: s.lastName,
    email: s.email,
    aal: s.aal,
  });
});

adminRoutes.route('/', peopleRoutes);
adminRoutes.route('/', referenceRoutes);
adminRoutes.route('/', configRoutes);
adminRoutes.route('/', definitionRoutes);
adminRoutes.route('/', jobRoutes);
adminRoutes.route('/', opsRoutes);
