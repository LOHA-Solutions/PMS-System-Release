import { getIntlLocale } from '../i18n/store.js';

const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export async function loadPublicPlans(signal) {
  const response = await fetch(`${apiBase}/api/public/plans`, {
    signal,
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok)
    throw new Error('Không tải được bảng giá. Vui lòng thử lại.');
  return response.json();
}

export function money(value, currency = 'VND') {
  const match = String(value ?? 0).match(/^(-?)(\d+)(?:\.(\d{0,4}))?$/);
  if (!match)
    return (
      Number(value).toLocaleString(getIntlLocale(), {
        minimumFractionDigits: currency === 'VND' ? 0 : 2,
        maximumFractionDigits: 4,
      }) +
      ' ' +
      (currency === 'VND' ? '₫' : currency)
    );
  const fraction = (match[3] || '')
    .replace(/0+$/, '')
    .padEnd(currency === 'VND' ? 0 : 2, '0');
  const separator = new Intl.NumberFormat(getIntlLocale())
    .formatToParts(1.1)
    .find((part) => part.type === 'decimal').value;
  return (
    match[1] +
    BigInt(match[2]).toLocaleString(getIntlLocale()) +
    (fraction ? separator + fraction : '') +
    ' ' +
    (currency === 'VND' ? '₫' : currency)
  );
}
