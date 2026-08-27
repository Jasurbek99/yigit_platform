import { describe, it, expect } from 'vitest';
import {
  groupPages,
  countPageChanges,
  countResourceChanges,
  changedFieldResources,
  countVisiblePages,
  togglePage,
  toggleResource,
  toggleField,
  toggleAllFields,
  EMPTY_PERM,
  type TPageMatrix,
  type TResourceMatrix,
  type TFieldMatrix,
} from './rolePermissionModel';
import { DEAD_RESOURCES, isDeadResource } from './deadResources';

describe('groupPages', () => {
  it('groups by the prefix before the first dot', () => {
    const groups = groupPages([
      { code: 'dashboard', label: 'Dashboard' },
      { code: 'export.shipments', label: 'Shipments' },
      { code: 'export.quota', label: 'Quota' },
      { code: 'admin.users', label: 'Users' },
    ]);

    expect(groups.map((g) => g.key)).toEqual(['main', 'export', 'admin']);
    expect(groups[1].items.map((i) => i.code)).toEqual(['export.shipments', 'export.quota']);
  });

  it('keeps registry order so the layout does not jump between loads', () => {
    const groups = groupPages([
      { code: 'export.a', label: 'A' },
      { code: 'admin.b', label: 'B' },
      { code: 'export.c', label: 'C' },
    ]);

    expect(groups.map((g) => g.key)).toEqual(['export', 'admin']);
    expect(groups[0].items.map((i) => i.code)).toEqual(['export.a', 'export.c']);
  });

  it('puts every dotless code in one main group', () => {
    const groups = groupPages([
      { code: 'dashboard', label: 'D' },
      { code: 'audit_log', label: 'A' },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('main');
  });
});

describe('countPageChanges', () => {
  const base: TPageMatrix = { document_team: { 'export.shipments': true, 'export.quota': false } };

  it('is zero with no draft', () => {
    expect(countPageChanges(base, null)).toBe(0);
  });

  it('is zero when the draft matches the saved matrix', () => {
    expect(countPageChanges(base, { document_team: { 'export.shipments': true } })).toBe(0);
  });

  it('counts each flipped checkbox', () => {
    const draft = togglePage(base, 'document_team', 'export.quota', true);
    expect(countPageChanges(base, draft)).toBe(1);
  });

  it('treats a missing saved key as false, not as a change to false', () => {
    expect(countPageChanges(base, { document_team: { 'export.new': false } })).toBe(0);
    expect(countPageChanges(base, { document_team: { 'export.new': true } })).toBe(1);
  });
});

describe('countResourceChanges', () => {
  const base: TResourceMatrix = {
    document_team: { shipment: { view: true, create: false, edit: true, delete: false } },
  };

  it('counts each of the four actions separately', () => {
    let draft = toggleResource(base, 'document_team', 'shipment', 'create', true);
    draft = toggleResource(draft, 'document_team', 'shipment', 'delete', true);
    expect(countResourceChanges(base, draft)).toBe(2);
  });

  it('is zero when a toggle is flipped back', () => {
    let draft = toggleResource(base, 'document_team', 'shipment', 'create', true);
    draft = toggleResource(draft, 'document_team', 'shipment', 'create', false);
    expect(countResourceChanges(base, draft)).toBe(0);
  });

  it('treats an unseeded resource as all-false', () => {
    const draft = toggleResource(base, 'document_team', 'packing_template', 'view', true);
    expect(countResourceChanges(base, draft)).toBe(1);
    expect(base.document_team.packing_template ?? EMPTY_PERM).toEqual(EMPTY_PERM);
  });
});

describe('changedFieldResources', () => {
  const base: TFieldMatrix = {
    shipment: { document_team: ['notes', 'documents_status'] },
    quota_usage: { document_team: ['*'] },
  };

  it('returns nothing when no draft exists', () => {
    expect(changedFieldResources(base, null)).toEqual([]);
  });

  it('ignores field-order differences — grants are a set', () => {
    const draft: TFieldMatrix = { shipment: { document_team: ['documents_status', 'notes'] } };
    expect(changedFieldResources(base, draft)).toEqual([]);
  });

  it('names only the resources that actually changed', () => {
    const draft = toggleField(base, 'shipment', 'document_team', 'box_count', true);
    expect(changedFieldResources(base, draft)).toEqual(['shipment']);
  });

  it('detects a revoked wildcard', () => {
    const draft = toggleAllFields(base, 'quota_usage', 'document_team', false);
    expect(changedFieldResources(base, draft)).toEqual(['quota_usage']);
  });

  it('detects a role added where none existed before', () => {
    const draft = toggleField(base, 'shipment', 'transport', 'truck_plate', true);
    expect(changedFieldResources(base, draft)).toEqual(['shipment']);
  });
});

describe('countVisiblePages', () => {
  it('counts only pages the role can see', () => {
    const matrix: TPageMatrix = {
      document_team: { 'export.shipments': true, 'export.quota': false },
    };
    const pages = [
      { code: 'export.shipments', label: 'A' },
      { code: 'export.quota', label: 'B' },
      { code: 'export.plan', label: 'C' },
    ];
    expect(countVisiblePages(matrix, 'document_team', pages)).toBe(1);
    expect(countVisiblePages(matrix, 'transport', pages)).toBe(0);
  });
});

describe('DEAD_RESOURCES', () => {
  it('names all eight resources the matrix does not actually enforce', () => {
    expect(Object.keys(DEAD_RESOURCES).sort()).toEqual([
      'domestic_sale',
      'greenhouse_block',
      'manifest_close',
      'pallet',
      'quality_document',
      'sales_report',
      'shipment_assign',
      'weekly_plan',
    ]);
  });

  it('does not flag a resource the matrix really does gate', () => {
    expect(isDeadResource('shipment')).toBe(false);
    expect(isDeadResource('packing_template')).toBe(false);
    expect(isDeadResource('pallet')).toBe(true);
  });

  it('gives every dead resource a reason and a source location to look at', () => {
    for (const [code, entry] of Object.entries(DEAD_RESOURCES)) {
      expect(entry.reason, code).toBeTruthy();
      expect(entry.where, code).toBeTruthy();
    }
  });
});
