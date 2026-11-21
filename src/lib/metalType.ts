// Metal type of an invoice line (item / order), from the metal lots it consumed:
// Gold, Gold 2 Tone, Silver, Gold Silver 2 Tone, Platinum, Gold Platinum 2 Tone.
//
// The ERP has one GOLD commodity for every gold colour, and the colour field on
// metal lots holds stone colours (GARNET, K, H…), so the gold colour is read from
// the lot code instead: 14KW / 14KY / 14KR are one colour, 14KWY / 18KYW two,
// 14KTT / 14K TT / 14KTTT / 14K 3T are two- or three-tone metal. A line whose gold
// lots have two different colours (a 14KW lot and a 14KY lot) is two-tone too.
// Three-tone counts as Gold 2 Tone.
//
// Findings (GOLD FINDING — posts, backs, clasps) and solder don't set the type of
// a line that has other metal: a 14KY earring back doesn't make a platinum
// earring gold-platinum. Steel and titanium wire (springs, pins) are ignored.

export const METAL_TYPES = [
  { code: 'GOLD', label: 'Gold' },
  { code: 'GOLD_2_TONE', label: 'Gold 2 Tone' },
  { code: 'SILVER', label: 'Silver' },
  { code: 'GOLD_SILVER_2_TONE', label: 'Gold Silver 2 Tone' },
  { code: 'PLATINUM', label: 'Platinum' },
  { code: 'GOLD_PLATINUM_2_TONE', label: 'Gold Platinum 2 Tone' },
  { code: 'OTHER', label: 'Other' },
] as const;

export type MetalType = (typeof METAL_TYPES)[number]['code'];

const LABEL = Object.fromEntries(METAL_TYPES.map((t) => [t.code, t.label])) as Record<MetalType, string>;
export const metalTypeLabel = (t: MetalType) => LABEL[t];
export const isMetalType = (s: string | null | undefined): s is MetalType => !!s && s in LABEL;

export interface MetalLot {
  commodity: string; // ERP commodity name, any case
  lotCode?: string | null;
}

// Gold colour letters after the karat: "14KW", "14K WY", "10KYG", "14KTT", "14K 3T".
const KARAT_SUFFIX = /\d{1,2}\s*K\s*(2T|3T|T{2,3}|[WYRPG]+)(?![A-Z])/;

// What a gold lot code says about colour: the colours it names, and whether the
// metal itself is two/three-tone.
export function goldColours(lotCode: string | null | undefined): { colours: string[]; multiTone: boolean } {
  const m = KARAT_SUFFIX.exec((lotCode ?? '').toUpperCase());
  if (!m) return { colours: [], multiTone: false };
  const suffix = m[1];
  if (/T/.test(suffix)) return { colours: [], multiTone: true };
  const colours = Array.from(new Set(suffix.replace(/G$/, '').split('').filter((c) => c !== 'G')));
  return { colours, multiTone: colours.length > 1 };
}

export function metalTypeOf(lots: MetalLot[]): MetalType {
  let gold = false;
  let silver = false;
  let platinum = false;
  let finding = false;
  let multiTone = false;
  const colours = new Set<string>();

  for (const lot of lots) {
    const c = lot.commodity.trim().toUpperCase();
    const code = (lot.lotCode ?? '').toUpperCase();
    if (c.includes('FINDING')) {
      finding = true;
      continue;
    }
    if (c.includes('MODERN GOLD')) continue; // a gold-look alloy, not gold
    const hasGold = c.includes('GOLD');
    const hasSilver = c.includes('SILVER');
    if (hasSilver) silver = true;
    if (c.includes('PLATINUM')) platinum = true;
    if (hasGold) {
      gold = true;
      if (!hasSilver && !code.includes('SOLDER')) {
        const g = goldColours(code);
        if (g.multiTone) multiTone = true;
        g.colours.forEach((x) => colours.add(x));
      }
    }
  }

  if (gold && silver) return 'GOLD_SILVER_2_TONE';
  if (gold && platinum) return 'GOLD_PLATINUM_2_TONE';
  if (gold) return multiTone || colours.size > 1 ? 'GOLD_2_TONE' : 'GOLD';
  if (silver) return 'SILVER';
  if (platinum) return 'PLATINUM';
  if (finding) return 'GOLD'; // a line of findings only
  return 'OTHER';
}
