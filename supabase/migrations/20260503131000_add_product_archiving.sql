-- Add is_active column to products table for soft-deletion/archiving
ALTER TABLE public.products ADD COLUMN is_active boolean DEFAULT true NOT NULL;

-- Update existing products to be active (already handled by DEFAULT, but just to be sure if there were nulls)
UPDATE public.products SET is_active = true WHERE is_active IS NULL;
