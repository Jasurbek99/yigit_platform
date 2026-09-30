import { FONT } from '@/constants/styles';

/** The export code beside the shipment code in a board card header. */
export function ExportCode({ code }: { code: string }) {
  return (
    <>
      {' · '}
      <span style={{ fontFamily: FONT.mono, fontWeight: 600, color: '#d46b08' }}>{code}</span>
    </>
  );
}
