-- Product picture (POST /v1/files/upload-url purpose product_image, attached via
-- PUT /v1/products/{id}/image). Holds the R2 key only (`<companyId>/product_image/...`), same
-- pattern as expense_attachments.file_key / attendance selfie_file_key. Nullable, additive; RLS and
-- the products_row_meta trigger (updated_at/version) are unchanged.
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_file_key text;
