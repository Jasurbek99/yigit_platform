import { useState, useMemo, useCallback } from 'react';
import {
  Tabs,
  Card,
  Select,
  Button,
  Tag,
  Table,
  Badge,
  Checkbox,
  Drawer,
  Divider,
  Space,
  Flex,
  Typography,
  Spin,
  Alert,
  Tooltip,
} from 'antd';
import { IconShield } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useAdminUsers,
  useGreenhouseBlocks,
  useBlockAssignments,
  useCreateBlockAssignment,
  useDeleteBlockAssignment,
  useUpdateUserPermissions,
  usePagePermissions,
  useSavePagePermissions,
  useResourcePermissions,
  useSaveResourcePermissions,
  useFieldPermissions,
  useSaveFieldPermissions,
} from '@/hooks/useAdmin';
import type { IAdminUser, IGreenhouseBlock, IBlockAssignment } from '@/types';

const { Text } = Typography;

// ─── Block Assignments Tab ────────────────────────────────────────────────────

interface BlockAssignmentsTabProps {
  managers: IAdminUser[];
  blocks: IGreenhouseBlock[];
  assignments: IBlockAssignment[];
  isLoading: boolean;
}

function BlockAssignmentsTab({
  managers,
  blocks,
  assignments,
  isLoading,
}: BlockAssignmentsTabProps) {
  const { t } = useTranslation();
  const [selectedBlocks, setSelectedBlocks] = useState<Record<number, number[]>>({});

  const createAssignment = useCreateBlockAssignment({
    onSuccess: () => toast.success(t('permissions_admin.toast_block_added')),
    onError: () => toast.error(t('permissions_admin.toast_error')),
  });

  const deleteAssignment = useDeleteBlockAssignment({
    onError: () => toast.error(t('permissions_admin.toast_error')),
  });

  if (isLoading) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {managers.map((manager) => {
        const userAssignments = assignments.filter((a) => a.user === manager.id);
        const assignedBlockIds = new Set(userAssignments.map((a) => a.block));
        const availableBlocks = blocks
          .filter((b) => b.is_active && !assignedBlockIds.has(b.id))
          .map((b) => ({ value: b.id, label: b.code + (b.name ? ` — ${b.name}` : '') }));

        const pendingBlocks = selectedBlocks[manager.id] ?? [];

        function handleAdd() {
          if (pendingBlocks.length === 0) return;
          pendingBlocks.forEach((blockId) => {
            createAssignment.mutate({ user: manager.id, block: blockId });
          });
          setSelectedBlocks((prev) => ({ ...prev, [manager.id]: [] }));
        }

        return (
          <Card key={manager.id} size="small" style={{ borderRadius: 8 }}>
            <Flex align="center" gap={12} wrap="wrap">
              <div style={{ minWidth: 140 }}>
                <Text strong style={{ fontSize: 13 }}>
                  {manager.username}
                </Text>
                {(manager.first_name || manager.last_name) && (
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, display: 'block' }}
                  >
                    {[manager.first_name, manager.last_name].filter(Boolean).join(' ')}
                  </Text>
                )}
              </div>

              <Flex gap={4} wrap="wrap" style={{ flex: 1 }}>
                {userAssignments.length === 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('common.empty')}
                  </Text>
                )}
                {userAssignments.map((a) => (
                  <Tag
                    key={a.id}
                    closable
                    onClose={() => deleteAssignment.mutate(a.id)}
                    color="blue"
                  >
                    {a.block_code}
                  </Tag>
                ))}
              </Flex>

              <Flex gap={8} align="center">
                <Select
                  mode="multiple"
                  style={{ minWidth: 200 }}
                  placeholder={t('permissions_admin.block_select_ph')}
                  options={availableBlocks}
                  value={pendingBlocks}
                  onChange={(vals) =>
                    setSelectedBlocks((prev) => ({ ...prev, [manager.id]: vals }))
                  }
                  maxTagCount={3}
                  size="small"
                />
                <Button
                  size="small"
                  type="primary"
                  onClick={handleAdd}
                  disabled={pendingBlocks.length === 0}
                  loading={createAssignment.isPending}
                >
                  {t('permissions_admin.block_add_btn')}
                </Button>
              </Flex>
            </Flex>
          </Card>
        );
      })}

      {managers.length === 0 && (
        <Alert message={t('permissions_admin.no_managers')} type="info" />
      )}
    </Space>
  );
}

// ─── Legacy Permissions Tab ──────────────────────────────────────────────────

interface IPermissionDef {
  codename: string;
  label: string;
}

interface IPermissionGroup {
  group: string;
  permissions: IPermissionDef[];
}

const ROLE_COLOR: Record<string, string> = {
  director: 'red',
  export_manager: 'blue',
  greenhouse_manager: 'green',
  warehouse_chief: 'cyan',
  document_team: 'geekblue',
  transport: 'orange',
  sales_rep: 'lime',
  finansist: 'gold',
  accountant: 'purple',
  seller: 'volcano',
};

interface PermissionsTabProps {
  users: IAdminUser[];
  isLoading: boolean;
}

function PermissionsTab({ users, isLoading }: PermissionsTabProps) {
  const { t } = useTranslation();
  const [permState, setPermState] = useState<Record<number, string[]>>({});
  const [selectedUser, setSelectedUser] = useState<IAdminUser | null>(null);
  const [draftPerms, setDraftPerms] = useState<string[]>([]);

  const permissionGroups = useMemo<IPermissionGroup[]>(() => [
    {
      group: t('permissions_admin.group_harvest_plan'),
      permissions: [
        { codename: 'add_weeklyharvestplan', label: t('permissions_admin.perm_add_weeklyharvestplan') },
        { codename: 'change_weeklyharvestplan', label: t('permissions_admin.perm_change_weeklyharvestplan') },
      ],
    },
    {
      group: t('permissions_admin.group_firms'),
      permissions: [
        { codename: 'add_exportfirm',    label: t('permissions_admin.perm_add_exportfirm') },
        { codename: 'change_exportfirm', label: t('permissions_admin.perm_change_exportfirm') },
        { codename: 'delete_exportfirm', label: t('permissions_admin.perm_delete_exportfirm') },
        { codename: 'add_importfirm',    label: t('permissions_admin.perm_add_importfirm') },
        { codename: 'change_importfirm', label: t('permissions_admin.perm_change_importfirm') },
        { codename: 'delete_importfirm', label: t('permissions_admin.perm_delete_importfirm') },
      ],
    },
  ], [t]);

  const updatePermissions = useUpdateUserPermissions({
    onError: () => toast.error(t('permissions_admin.toast_perm_error')),
  });

  function openDrawer(user: IAdminUser): void {
    setSelectedUser(user);
    setDraftPerms(permState[user.id] ?? []);
  }

  function handleClose(): void {
    setSelectedUser(null);
  }

  function handleSave(): void {
    if (!selectedUser) return;
    updatePermissions.mutate(
      { id: selectedUser.id, permissions: draftPerms },
      {
        onSuccess: () => {
          setPermState((prev) => ({ ...prev, [selectedUser.id]: draftPerms }));
          toast.success(t('permissions_admin.toast_save_success'));
          handleClose();
        },
      },
    );
  }

  function togglePerm(codename: string, checked: boolean): void {
    setDraftPerms((prev) =>
      checked ? [...prev, codename] : prev.filter((p) => p !== codename),
    );
  }

  const columns = [
    {
      title: t('permissions_admin.col_user'),
      dataIndex: 'username',
      key: 'username',
      render: (_: unknown, record: IAdminUser) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{record.username}</Text>
          {(record.first_name || record.last_name) && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {[record.first_name, record.last_name].filter(Boolean).join(' ')}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: t('permissions_admin.col_role'),
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => (
        <Tag color={ROLE_COLOR[role] ?? 'default'}>{role}</Tag>
      ),
    },
    {
      title: t('permissions_admin.col_permissions'),
      key: 'permissions',
      render: (_: unknown, record: IAdminUser) => {
        const count = (permState[record.id] ?? []).length;
        return count > 0 ? (
          <Badge count={count} color="blue" />
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>{t('permissions_admin.perm_count', { count: 0 })}</Text>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      render: (_: unknown, record: IAdminUser) => (
        <Button size="small" onClick={() => openDrawer(record)}>
          {t('common.manage')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Table<IAdminUser>
        rowKey="id"
        dataSource={users}
        columns={columns}
        loading={isLoading}
        size="small"
        pagination={false}
        style={{ background: '#fff', borderRadius: 8 }}
      />

      <Drawer
        open={selectedUser !== null}
        maskClosable={false}
        title={
          selectedUser && (
            <Space>
              <Text strong>{selectedUser.username}</Text>
              <Tag color={ROLE_COLOR[selectedUser.role] ?? 'default'}>
                {selectedUser.role}
              </Tag>
            </Space>
          )
        }
        width={420}
        onClose={handleClose}
        footer={
          <Flex justify="flex-end" gap={8}>
            <Button onClick={handleClose}>{t('common.cancel')}</Button>
            <Button
              type="primary"
              onClick={handleSave}
              loading={updatePermissions.isPending}
            >
              {t('common.save')}
            </Button>
          </Flex>
        }
      >
        {permissionGroups.map((pg) => (
          <div key={pg.group}>
            <Divider style={{ fontSize: 12 }}>
              {pg.group}
            </Divider>
            <Space direction="vertical" size={8} style={{ paddingLeft: 8 }}>
              {pg.permissions.map((perm) => (
                <Checkbox
                  key={perm.codename}
                  checked={draftPerms.includes(perm.codename)}
                  onChange={(e) => togglePerm(perm.codename, e.target.checked)}
                >
                  {perm.label}
                </Checkbox>
              ))}
            </Space>
          </div>
        ))}
      </Drawer>
    </>
  );
}

// ─── Page Visibility Matrix Tab ──────────────────────────────────────────────

function PageVisibilityTab() {
  const { t } = useTranslation();
  const { data, isLoading } = usePagePermissions();
  const saveMutation = useSavePagePermissions({
    onSuccess: () => toast.success(t('permissions_admin.toast_matrix_saved')),
    onError: () => toast.error(t('permissions_admin.toast_matrix_error')),
  });

  const [draft, setDraft] = useState<Record<string, Record<string, boolean>> | null>(null);

  // Initialize draft from server data
  const matrix = draft ?? data?.matrix ?? {};

  const handleToggle = useCallback((role: string, pageCode: string, checked: boolean) => {
    setDraft((prev) => {
      const base = prev ?? data?.matrix ?? {};
      return {
        ...base,
        [role]: { ...(base[role] ?? {}), [pageCode]: checked },
      };
    });
  }, [data?.matrix]);

  const handleSave = useCallback(() => {
    saveMutation.mutate(matrix, {
      onSuccess: () => setDraft(null),
    });
  }, [matrix, saveMutation]);

  if (isLoading || !data) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  const columns = [
    {
      title: t('permissions_admin.col_page'),
      dataIndex: 'label',
      key: 'label',
      fixed: 'left' as const,
      width: 200,
      render: (label: string, record: { code: string; label: string }) => (
        <Tooltip title={record.code}>
          <Text style={{ fontSize: 12 }}>{label}</Text>
        </Tooltip>
      ),
    },
    ...data.roles.map((role) => ({
      title: <Tag color={ROLE_COLOR[role] ?? 'default'} style={{ fontSize: 10 }}>{role}</Tag>,
      key: role,
      width: 90,
      align: 'center' as const,
      render: (_: unknown, record: { code: string }) => (
        <Checkbox
          checked={matrix[role]?.[record.code] ?? false}
          onChange={(e) => handleToggle(role, record.code, e.target.checked)}
        />
      ),
    })),
  ];

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        {t('permissions_admin.page_vis_desc')}
      </Text>
      <Table
        rowKey="code"
        dataSource={data.pages}
        columns={columns}
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        style={{ background: '#fff', borderRadius: 8 }}
      />
      <Flex justify="flex-end" style={{ marginTop: 16 }}>
        <Button
          type="primary"
          onClick={handleSave}
          loading={saveMutation.isPending}
          disabled={!draft}
        >
          {t('permissions_admin.save_matrix')}
        </Button>
      </Flex>
    </div>
  );
}

// ─── Resource Permissions Matrix Tab ─────────────────────────────────────────

function ResourcePermissionsTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useResourcePermissions();
  const saveMutation = useSaveResourcePermissions({
    onSuccess: () => toast.success(t('permissions_admin.toast_matrix_saved')),
    onError: () => toast.error(t('permissions_admin.toast_matrix_error')),
  });

  type PermFlags = { view: boolean; create: boolean; edit: boolean; delete: boolean };
  const [draft, setDraft] = useState<Record<string, Record<string, PermFlags>> | null>(null);

  const matrix = draft ?? data?.matrix ?? {};

  const handleToggle = useCallback((role: string, resourceCode: string, action: keyof PermFlags, checked: boolean) => {
    setDraft((prev) => {
      const base = prev ?? data?.matrix ?? {};
      const current = base[role]?.[resourceCode] ?? { view: false, create: false, edit: false, delete: false };
      return {
        ...base,
        [role]: {
          ...(base[role] ?? {}),
          [resourceCode]: { ...current, [action]: checked },
        },
      };
    });
  }, [data?.matrix]);

  const handleSave = useCallback(() => {
    saveMutation.mutate(matrix, {
      onSuccess: () => setDraft(null),
    });
  }, [matrix, saveMutation]);

  if (isLoading || !data) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  const actions: (keyof PermFlags)[] = ['view', 'create', 'edit', 'delete'];
  const actionLabels: Record<keyof PermFlags, string> = {
    view: t('permissions_admin.label_view'),
    create: t('permissions_admin.label_create'),
    edit: t('permissions_admin.label_edit'),
    delete: t('permissions_admin.label_delete'),
  };

  const columns = [
    {
      title: t('permissions_admin.col_resource'),
      dataIndex: 'label',
      key: 'label',
      fixed: 'left' as const,
      width: 180,
      render: (label: string, record: { code: string }) => (
        <Tooltip title={record.code}>
          <Text style={{ fontSize: 12 }}>{label}</Text>
        </Tooltip>
      ),
    },
    ...data.roles.map((role) => ({
      title: <Tag color={ROLE_COLOR[role] ?? 'default'} style={{ fontSize: 10 }}>{role}</Tag>,
      key: role,
      width: 120,
      align: 'center' as const,
      render: (_: unknown, record: { code: string }) => {
        const perms = matrix[role]?.[record.code] ?? { view: false, create: false, edit: false, delete: false };
        return (
          <Flex gap={2} justify="center">
            {actions.map((action) => (
              <Tooltip key={action} title={action}>
                <Checkbox
                  checked={perms[action]}
                  onChange={(e) => handleToggle(role, record.code, action, e.target.checked)}
                  style={{ marginInlineEnd: 0 }}
                >
                  <span style={{ fontSize: 10 }}>{actionLabels[action]}</span>
                </Checkbox>
              </Tooltip>
            ))}
          </Flex>
        );
      },
    })),
  ];

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        {t('permissions_admin.resource_perms_desc')}
      </Text>
      <Table
        rowKey="code"
        dataSource={data.resources}
        columns={columns}
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        style={{ background: '#fff', borderRadius: 8 }}
      />
      <Flex justify="flex-end" style={{ marginTop: 16 }}>
        <Button
          type="primary"
          onClick={handleSave}
          loading={saveMutation.isPending}
          disabled={!draft}
        >
          {t('permissions_admin.save_matrix')}
        </Button>
      </Flex>
    </div>
  );
}

// ─── Field Permissions Matrix Tab ────────────────────────────────────────────

function FieldPermissionsTab() {
  const { t } = useTranslation();
  const [selectedResource, setSelectedResource] = useState<string | undefined>(undefined);
  const { data, isLoading } = useFieldPermissions(selectedResource);
  const saveMutation = useSaveFieldPermissions({
    onSuccess: () => toast.success(t('permissions_admin.toast_matrix_saved')),
    onError: () => toast.error(t('permissions_admin.toast_matrix_error')),
  });

  const [draft, setDraft] = useState<Record<string, string[]> | null>(null);

  const resourceFields = data?.resource_fields ?? {};
  const fields = selectedResource ? (resourceFields[selectedResource] ?? []) : [];
  const currentMatrix = selectedResource
    ? (draft ?? data?.matrix?.[selectedResource] ?? {})
    : {};

  const roles = data?.roles ?? [];

  // Resource select options
  const resourceOptions = Object.entries(resourceFields).map(([code, fieldList]) => ({
    value: code,
    label: `${code} (${fieldList.length} fields)`,
  }));

  const handleToggle = useCallback((role: string, fieldName: string, checked: boolean) => {
    setDraft((prev) => {
      const base = prev ?? (selectedResource ? data?.matrix?.[selectedResource] ?? {} : {});
      const currentFields = base[role] ?? [];
      const newFields = checked
        ? [...currentFields.filter((f) => f !== fieldName), fieldName]
        : currentFields.filter((f) => f !== fieldName);
      return { ...base, [role]: newFields };
    });
  }, [selectedResource, data?.matrix]);

  const handleToggleAll = useCallback((role: string, checked: boolean) => {
    setDraft((prev) => {
      const base = prev ?? (selectedResource ? data?.matrix?.[selectedResource] ?? {} : {});
      return { ...base, [role]: checked ? ['*'] : [] };
    });
  }, [selectedResource, data?.matrix]);

  const handleSave = useCallback(() => {
    if (!selectedResource) return;
    saveMutation.mutate(
      { resource: selectedResource, matrix: currentMatrix },
      { onSuccess: () => setDraft(null) },
    );
  }, [selectedResource, currentMatrix, saveMutation]);

  const handleResourceChange = useCallback((value: string) => {
    setSelectedResource(value);
    setDraft(null);
  }, []);

  if (isLoading && selectedResource) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  // Build table: rows = fields (+ '*' row), columns = roles
  const allFieldRows = [
    { field: '*', label: t('permissions_admin.all_fields') },
    ...fields.map((f) => ({ field: f, label: f })),
  ];

  const columns = [
    {
      title: t('permissions_admin.col_field'),
      dataIndex: 'label',
      key: 'label',
      fixed: 'left' as const,
      width: 180,
      render: (label: string, record: { field: string }) => (
        <Text style={{ fontSize: 12, fontWeight: record.field === '*' ? 600 : 400 }}>{label}</Text>
      ),
    },
    ...roles.map((role) => ({
      title: <Tag color={ROLE_COLOR[role] ?? 'default'} style={{ fontSize: 10 }}>{role}</Tag>,
      key: role,
      width: 90,
      align: 'center' as const,
      render: (_: unknown, record: { field: string }) => {
        const roleFields = currentMatrix[role] ?? [];
        const isAllFields = roleFields.includes('*');

        if (record.field === '*') {
          return (
            <Checkbox
              checked={isAllFields}
              onChange={(e) => handleToggleAll(role, e.target.checked)}
            />
          );
        }
        return (
          <Checkbox
            checked={isAllFields || roleFields.includes(record.field)}
            disabled={isAllFields}
            onChange={(e) => handleToggle(role, record.field, e.target.checked)}
          />
        );
      },
    })),
  ];

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        {t('permissions_admin.field_perms_desc')}
      </Text>
      <Select
        placeholder={t('permissions_admin.select_resource')}
        options={resourceOptions}
        value={selectedResource}
        onChange={handleResourceChange}
        style={{ width: 300, marginBottom: 16 }}
      />
      {selectedResource && fields.length > 0 ? (
        <>
          <Table
            rowKey="field"
            dataSource={allFieldRows}
            columns={columns}
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
            style={{ background: '#fff', borderRadius: 8 }}
          />
          <Flex justify="flex-end" style={{ marginTop: 16 }}>
            <Button
              type="primary"
              onClick={handleSave}
              loading={saveMutation.isPending}
              disabled={!draft}
            >
              {t('permissions_admin.save_matrix')}
            </Button>
          </Flex>
        </>
      ) : selectedResource ? (
        <Alert message={t('permissions_admin.no_field_config')} type="info" />
      ) : null}
    </div>
  );
}

// ─── PermissionsPage ──────────────────────────────────────────────────────────

export default function PermissionsPage() {
  const { t } = useTranslation();

  const { data: allUsers = [], isLoading: usersLoading } = useAdminUsers();
  const { data: blocks = [], isLoading: blocksLoading } = useGreenhouseBlocks();
  const { data: assignments = [], isLoading: assignmentsLoading } = useBlockAssignments();

  const managers = allUsers.filter((u) => u.role === 'greenhouse_manager');
  const blockTabLoading = usersLoading || blocksLoading || assignmentsLoading;

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: '#1f1f1f',
            lineHeight: '1.3',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <IconShield size={18} color="#1677ff" />
          {t('nav.admin_permissions')}
        </div>
        <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
          {t('permissions_admin.subtitle')}
        </div>
      </div>

      <Tabs
        defaultActiveKey="page_visibility"
        items={[
          {
            key: 'page_visibility',
            label: t('permissions_admin.tab_page_visibility'),
            children: <PageVisibilityTab />,
          },
          {
            key: 'resource_perms',
            label: t('permissions_admin.tab_resource_perms'),
            children: <ResourcePermissionsTab />,
          },
          {
            key: 'field_perms',
            label: t('permissions_admin.tab_field_perms'),
            children: <FieldPermissionsTab />,
          },
          {
            key: 'blocks',
            label: t('permissions_admin.tab_blocks'),
            children: (
              <BlockAssignmentsTab
                managers={managers}
                blocks={blocks}
                assignments={assignments}
                isLoading={blockTabLoading}
              />
            ),
          },
          {
            key: 'permissions',
            label: t('permissions_admin.tab_permissions'),
            children: (
              <PermissionsTab users={allUsers} isLoading={usersLoading} />
            ),
          },
        ]}
      />
    </div>
  );
}
