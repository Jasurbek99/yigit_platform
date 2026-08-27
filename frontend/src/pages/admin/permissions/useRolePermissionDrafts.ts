import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  usePagePermissions, useSavePagePermissions,
  useResourcePermissions, useSaveResourcePermissions,
  useFieldPermissions, useSaveFieldPermissions,
} from '@/hooks/useAdmin';
import {
  changedFieldResources,
  countPageChanges,
  countResourceChanges,
  togglePage,
  toggleResource,
  toggleField,
  toggleAllFields,
  type IPermFlags,
  type TFieldMatrix,
  type TPageMatrix,
  type TResourceMatrix,
} from './rolePermissionModel';

/**
 * Loads all three permission matrices, holds one draft per matrix, and saves
 * only what changed.
 *
 * The three endpoints stay as they are — the page/resource ones take a FULL
 * matrix (the backend validates that every role is present), while the field one
 * takes a single resource per request. So "save only what changed" means: skip
 * the whole PUT for an untouched section, and send one field PUT per touched
 * resource. Re-sending an untouched resource would clobber a concurrent edit by
 * another admin.
 */
export function useRolePermissionDrafts(role: string | null) {
  const { t } = useTranslation();

  const pageQuery = usePagePermissions();
  const resourceQuery = useResourcePermissions();
  const fieldQuery = useFieldPermissions();

  const [pageDraft, setPageDraft] = useState<TPageMatrix | null>(null);
  const [resourceDraft, setResourceDraft] = useState<TResourceMatrix | null>(null);
  const [fieldDraft, setFieldDraft] = useState<TFieldMatrix | null>(null);

  const onSaveError = () => toast.error(t('permissions_admin.toast_matrix_error'));
  const savePages = useSavePagePermissions({ onError: onSaveError });
  const saveResources = useSaveResourcePermissions({ onError: onSaveError });
  const saveFields = useSaveFieldPermissions({ onError: onSaveError });

  const basePages = pageQuery.data?.matrix ?? {};
  const baseResources = resourceQuery.data?.matrix ?? {};
  const baseFields = fieldQuery.data?.matrix ?? {};

  const pageMatrix = pageDraft ?? basePages;
  const resourceMatrix = resourceDraft ?? baseResources;
  const fieldMatrix = fieldDraft ?? baseFields;

  const dirtyFieldResources = useMemo(
    () => changedFieldResources(baseFields, fieldDraft),
    [baseFields, fieldDraft],
  );
  const dirtyCount = useMemo(
    () => countPageChanges(basePages, pageDraft)
      + countResourceChanges(baseResources, resourceDraft)
      + dirtyFieldResources.length,
    [basePages, pageDraft, baseResources, resourceDraft, dirtyFieldResources],
  );

  const onTogglePage = useCallback((code: string, checked: boolean) => {
    if (!role) return;
    setPageDraft((prev) => togglePage(prev ?? basePages, role, code, checked));
  }, [role, basePages]);

  const onToggleResource = useCallback(
    (code: string, action: keyof IPermFlags, checked: boolean) => {
      if (!role) return;
      setResourceDraft((prev) => toggleResource(prev ?? baseResources, role, code, action, checked));
    },
    [role, baseResources],
  );

  const onToggleField = useCallback((resource: string, field: string, checked: boolean) => {
    if (!role) return;
    setFieldDraft((prev) => toggleField(prev ?? baseFields, resource, role, field, checked));
  }, [role, baseFields]);

  const onToggleAllFields = useCallback((resource: string, checked: boolean) => {
    if (!role) return;
    setFieldDraft((prev) => toggleAllFields(prev ?? baseFields, resource, role, checked));
  }, [role, baseFields]);

  const save = useCallback(async () => {
    const jobs: Promise<unknown>[] = [];
    if (pageDraft && countPageChanges(basePages, pageDraft) > 0) {
      jobs.push(savePages.mutateAsync(pageDraft));
    }
    if (resourceDraft && countResourceChanges(baseResources, resourceDraft) > 0) {
      jobs.push(saveResources.mutateAsync(resourceDraft));
    }
    for (const resource of dirtyFieldResources) {
      jobs.push(saveFields.mutateAsync({ resource, matrix: fieldMatrix[resource] ?? {} }));
    }
    if (jobs.length === 0) return;

    try {
      await Promise.all(jobs);
      setPageDraft(null);
      setResourceDraft(null);
      setFieldDraft(null);
      toast.success(t('permissions_admin.toast_matrix_saved'));
    } catch {
      // Each mutation toasted its own failure. Drafts are deliberately KEPT so
      // the admin can retry without re-ticking everything.
    }
  }, [
    pageDraft, basePages, savePages,
    resourceDraft, baseResources, saveResources,
    dirtyFieldResources, fieldMatrix, saveFields, t,
  ]);

  return {
    roles: pageQuery.data?.roles ?? [],
    pages: pageQuery.data?.pages ?? [],
    resources: resourceQuery.data?.resources ?? [],
    resourceFields: fieldQuery.data?.resource_fields ?? {},
    pageMatrix,
    resourceMatrix,
    fieldMatrix,
    dirtyCount,
    onTogglePage,
    onToggleResource,
    onToggleField,
    onToggleAllFields,
    save,
    isLoading: pageQuery.isLoading || resourceQuery.isLoading || fieldQuery.isLoading,
    isReady: Boolean(pageQuery.data && resourceQuery.data && fieldQuery.data),
    isSaving: savePages.isPending || saveResources.isPending || saveFields.isPending,
  };
}
