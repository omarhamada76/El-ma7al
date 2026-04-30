export interface BalanceParams {
  initialDebt: number;
  totalInvoices: number;
  totalPayments: number;
}

export function calculateAccountBalance({ initialDebt, totalInvoices, totalPayments }: BalanceParams): number {
  return initialDebt + totalInvoices - totalPayments;
}

export function getInvoiceStatus(total: number, paid: number): 'Paid' | 'Partial' | 'Pending' {
  if (paid === total) return 'Paid';
  if (paid > 0 && paid < total) return 'Partial';
  return 'Pending';
}

export interface LineProfitParams {
  sellPrice: number;
  costPrice: number;
  qty: number;
}

export function calcLineProfit({ sellPrice, costPrice, qty }: LineProfitParams): number {
  return (sellPrice - costPrice) * qty;
}

export function calcInvoiceProfit(lines: LineProfitParams[]): number {
  return lines.reduce((sum, line) => sum + calcLineProfit(line), 0);
}

export function getBarnBalance(barnInvoices: number, barnPayments: number, initialDebt: number): number {
  return initialDebt + barnInvoices - barnPayments;
}
