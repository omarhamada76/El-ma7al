-- Make client_id optional for invoices and payments to support "Cash Customer" scenarios
ALTER TABLE public.invoices ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.payments ALTER COLUMN client_id DROP NOT NULL;
