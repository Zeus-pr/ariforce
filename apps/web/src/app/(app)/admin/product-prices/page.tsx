import { ProductPricesView } from '@/components/admin/product-prices-view';

export const metadata = { title: 'Product prices' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Product prices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          MRP, PTR and PTS for each product. Order values (POB) use PTR at the time the DCR is saved.
        </p>
      </div>
      <ProductPricesView />
    </div>
  );
}
