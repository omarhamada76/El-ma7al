import { 
  calculateAccountBalance, 
  getInvoiceStatus, 
  calcLineProfit, 
  calcInvoiceProfit, 
  getBarnBalance 
} from '../lib/financials';

describe('Module 1 - Financial Logic', () => {

  describe('calculateAccountBalance', () => {
    it('should correctly calculate balance with zero initial debt', () => {
      const result = calculateAccountBalance({ initialDebt: 0, totalInvoices: 500, totalPayments: 200 });
      expect(result).toBeCloseTo(300, 2);
    });

    it('should handle overpayment resulting in negative balance (client in credit)', () => {
      const result = calculateAccountBalance({ initialDebt: 100, totalInvoices: 200, totalPayments: 400 });
      expect(result).toBeCloseTo(-100, 2);
    });

    it('should carry over closing balance to next cycle initial debt', () => {
      // simulate cycle 1
      const cycle1Closing = calculateAccountBalance({ initialDebt: 0, totalInvoices: 1000, totalPayments: 250 });
      expect(cycle1Closing).toBeCloseTo(750, 2);
      
      // simulate cycle 2
      const cycle2Closing = calculateAccountBalance({ initialDebt: cycle1Closing, totalInvoices: 500, totalPayments: 1000 });
      expect(cycle2Closing).toBeCloseTo(250, 2);
    });
  });

  describe('getInvoiceStatus', () => {
    it('should return Paid when paid equals total', () => {
      expect(getInvoiceStatus(500, 500)).toBe('Paid');
    });

    it('should return Partial when paid is between 0 and total', () => {
      expect(getInvoiceStatus(500, 200)).toBe('Partial');
    });

    it('should return Pending when paid is 0', () => {
      expect(getInvoiceStatus(500, 0)).toBe('Pending');
    });
  });

  describe('calcLineProfit', () => {
    it('should correctly calculate profit for a single line item', () => {
      const result = calcLineProfit({ sellPrice: 150, costPrice: 100, qty: 3 });
      expect(result).toBeCloseTo(150, 2);
    });

    it('should correctly calculate negative profit (loss) for a line item', () => {
      const result = calcLineProfit({ sellPrice: 80, costPrice: 100, qty: 2 });
      expect(result).toBeCloseTo(-40, 2);
    });
  });

  describe('calcInvoiceProfit', () => {
    it('should calculate total profit from multiple line items', () => {
      const lines = [
        { sellPrice: 150, costPrice: 100, qty: 2 }, // profit +100
        { sellPrice: 50, costPrice: 20, qty: 5 },   // profit +150
      ];
      expect(calcInvoiceProfit(lines)).toBeCloseTo(250, 2);
    });

    it('should calculate total profit when some items are sold at a loss', () => {
      const lines = [
        { sellPrice: 100, costPrice: 100, qty: 2 }, // profit 0
        { sellPrice: 80, costPrice: 100, qty: 1 },  // profit -20
      ];
      expect(calcInvoiceProfit(lines)).toBeCloseTo(-20, 2);
    });
  });

  describe('getBarnBalance', () => {
    it('should calculate balance scoped to a single barn', () => {
      const result = getBarnBalance(1000, 200, 500); // 500 initial + 1000 invoices - 200 payments
      expect(result).toBeCloseTo(1300, 2);
    });

    it('should calculate barn balance natively considering zero values properly', () => {
      const result = getBarnBalance(0, 50, 0); 
      expect(result).toBeCloseTo(-50, 2);
    });
  });

});
