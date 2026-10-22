export function invoiceTotal(cents: number[]) {
  return cents.reduce((total, value) => total + value, 0);
}
