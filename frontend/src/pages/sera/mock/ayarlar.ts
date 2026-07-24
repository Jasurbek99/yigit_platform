/**
 * Sazlamalar (Ayarlar) — page-specific mock data.
 *
 * User list + section-access counters shown on the settings page. Visual-only
 * prototype — no persistence, no real permission enforcement.
 */

export type SeraUserRole = 'Ýolbaşçy' | 'Görüji';

export interface ISeraUser {
  readonly id: string;
  readonly name: string;
  readonly login: string;
  readonly greeting: string;
  readonly role: SeraUserRole;
  readonly sectionsGranted: number;
}

/** Total number of app sections a user's access can be granted across. */
export const SERA_TOTAL_SECTIONS = 19;

export const SERA_USERS: readonly ISeraUser[] = [
  { id: 'u1', name: 'Yigit HJ export', login: '2019', greeting: 'Yigit HJ export', role: 'Ýolbaşçy', sectionsGranted: 0 },
  { id: 'u2', name: 'MUDURLER', login: 'mudurler', greeting: '', role: 'Görüji', sectionsGranted: 0 },
  { id: 'u3', name: 'soltanmyrat', login: 'Soltanmyrat', greeting: 'Soltanmyrat Pirjikow', role: 'Görüji', sectionsGranted: 0 },
  { id: 'u4', name: 'export', login: 'Export', greeting: 'Export işgarleri', role: 'Görüji', sectionsGranted: 0 },
  { id: 'u5', name: 'ex', login: 'ex', greeting: '', role: 'Görüji', sectionsGranted: 0 },
  { id: 'u6', name: 'Josgun', login: 'Josgun', greeting: '', role: 'Görüji', sectionsGranted: 0 },
  { id: 'u7', name: '1115', login: '1115', greeting: 'Döwranow Eziz Agamyradowiç', role: 'Görüji', sectionsGranted: 0 },
  { id: 'u8', name: '2002', login: '2002', greeting: 'Agamyrat Çaryýew', role: 'Görüji', sectionsGranted: 0 },
  { id: 'u9', name: '1114', login: '1114', greeting: 'Döwranow Jumamyrat Agamyradowiç', role: 'Görüji', sectionsGranted: 0 },
  { id: 'u10', name: '1010', login: '1010', greeting: 'Açylow Polat', role: 'Görüji', sectionsGranted: 0 },
  { id: 'u11', name: 'Gandymow Kuwat', login: 'Kuwat', greeting: 'Gandymow Kuwat', role: 'Görüji', sectionsGranted: 0 },
];
