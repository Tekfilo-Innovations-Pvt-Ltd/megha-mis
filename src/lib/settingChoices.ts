// Setting types the user chose for stones the ERP records none for.
//
// Most invoices carry no setting type on their stone components (RTPHK, ADGPHK
// never; AAA only since May 2026), so the chart would otherwise price those
// stones with the type named on the invoice's Setting row, else a default.
// Here a user picks a type per distinct stone — lot code + shape + MM size, as
// the report shows them (after customer stone corrections) — and a default for
// the rest. Choices are per company and per chart (type codes are the chart's).
//
// Order a stone's type is taken in: the ERP's; the choice for its lot code /
// shape / MM size; the type named on the invoice's Setting labour row; the
// chosen default (else Prong/Pave).

export interface SettingChoices {
  defaultSettingType: string | null; // chart type code for stones with no other type; null = Prong/Pave
  choices: Record<string, string>; // settingChoiceKey → chart type code
  updatedAt: string;
  updatedBy: string | null;
}

const part = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();

export const settingChoiceKey = (lotCode: string | null | undefined, shape: string | null | undefined, mmSize: string | null | undefined) =>
  [part(lotCode), part(shape), part(mmSize)].join('|');

export const FALLBACK_SETTING_TYPE = 'PRONG_PAVE';

// Any ERP login may change the choices; the shared MIS viewer login
// (src/lib/sharedLogin.ts, user id "shared:<name>") is view only.
export const isSharedViewer = (userId: string | null | undefined) => !!userId && userId.startsWith('shared:');
