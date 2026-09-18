/**
 * Accepts "12345", "1.2.3.4.5", "1 2 3 4 5" (or any mix of dot/space separators)
 * and normalizes to the plain digit string Telegram's API expects.
 */
export function normalizeLoginCode(input: string): string {
  const cleaned = input.replace(/[.\s]/g, "");
  if (!/^\d{4,7}$/.test(cleaned)) {
    throw new Error("Kod faqat raqamlardan iborat bo'lishi va 4-7 xonali bo'lishi kerak");
  }
  return cleaned;
}

export function normalizePhoneNumber(input: string): string {
  const cleaned = input.replace(/[\s()-]/g, "");
  if (!/^\+\d{7,15}$/.test(cleaned)) {
    throw new Error("Telefon raqami noto'g'ri formatda (masalan: +998901234567)");
  }
  return cleaned;
}
