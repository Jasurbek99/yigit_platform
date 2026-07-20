import dayjs from 'dayjs';

export function fmt(val: string | null | undefined): string {
  if (!val) return '—';
  return dayjs(val).format('DD.MM.YYYY HH:mm');
}

export function fmtDate(val: string | null | undefined): string {
  if (!val) return '—';
  return dayjs(val).format('DD.MM.YYYY');
}

export function fmtNum(val: number | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

/**
 * Scroll a Detail-page field into view and open its editor.
 *
 * DetailFieldRow's read-state value cell carries `tabIndex=0` and enters edit
 * mode on focus, so focusing it is what actually opens the field. Read-only
 * rows render with `tabIndex=-1` and are therefore scrolled to but not
 * opened — intended, since the user cannot edit them anyway.
 */
export function jumpToField(fieldKey: string): void {
  const el = document.getElementById(`detail-field-${fieldKey}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
}
