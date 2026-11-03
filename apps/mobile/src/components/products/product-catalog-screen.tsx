import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { PullToRefresh } from '@/components/refresh';
import { List } from '@/components/scroll';
import { SearchBox } from '@/components/masters/search-box';
import { SkeletonCard, SkeletonGroup } from '@/components/skeleton';
import { productStrength } from '@/lib/product-name';
import { useProducts } from '@/lib/products';
import { formatINR } from '@/lib/money';
import type { Product } from '@ariforce/contracts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, radius, spacing } from '@/theme';

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <AppText variant="small" style={styles.detailLabel}>
        {label}
      </AppText>
      <AppText selectable variant="body">
        {value}
      </AppText>
    </View>
  );
}

function ProductCard({ product }: { product: Product }) {
  const strength = productStrength(product.name);
  return (
    <Card style={styles.product}>
      <View style={styles.heading}>
        <AppText selectable variant="headline" style={styles.name}>
          {product.name}
        </AppText>
        <AppText selectable variant="small">
          {product.code}
        </AppText>
      </View>
      <Detail label="Composition" value={product.composition || 'Not specified'} />
      <Detail label="Strength" value={strength || 'Not specified'} />
      {product.packSize ? <Detail label="Pack size" value={product.packSize} /> : null}
      <View style={styles.prices}>
        <View style={styles.price}>
          <AppText variant="small" style={styles.detailLabel}>
            MRP
          </AppText>
          <AppText selectable variant="label">
            {product.mrp == null ? 'Not set' : formatINR(product.mrp)}
          </AppText>
        </View>
        <View style={styles.price}>
          <AppText variant="small" style={styles.detailLabel}>
            PTS
          </AppText>
          <AppText selectable variant="label">
            {product.pts == null ? 'Not set' : formatINR(product.pts)}
          </AppText>
        </View>
      </View>
    </Card>
  );
}

export function ProductCatalogScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const productsQuery = useProducts(query);
  const products = useMemo(
    () => productsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [productsQuery.data],
  );
  const total = productsQuery.data?.pages[0]?.total;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Products' }} />
      <View style={styles.top}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search products" />
        {typeof total === 'number' ? (
          <AppText variant="small">
            {total} {total === 1 ? 'product' : 'products'}
          </AppText>
        ) : null}
        {productsQuery.isError && products.length > 0 && !productsQuery.isFetchNextPageError ? (
          <View style={styles.error}>
            <AppText variant="small" style={styles.errorText}>
              Could not refresh products. Showing loaded results.
            </AppText>
            <Button
              label="Retry"
              compact
              variant="secondary"
              onPress={() => void productsQuery.refetch()}
            />
          </View>
        ) : null}
      </View>
      <PullToRefresh onRefresh={() => productsQuery.refetch()}>
        <List
          data={products}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + layout.section },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (productsQuery.hasNextPage && !productsQuery.isFetchingNextPage)
              void productsQuery.fetchNextPage();
          }}
          renderItem={({ item }) => <ProductCard product={item} />}
          ListEmptyComponent={
            productsQuery.isPending && productsQuery.fetchStatus !== 'paused' ? (
              <SkeletonGroup style={styles.loading}>
                <SkeletonCard lines={4} />
                <SkeletonCard lines={4} />
              </SkeletonGroup>
            ) : productsQuery.isError ? (
              <View style={styles.empty}>
                <AppText variant="bodyMuted" style={styles.emptyText}>
                  {productsQuery.error.message || 'Could not load products.'}
                </AppText>
                <Button
                  label="Try again"
                  compact
                  onPress={() => void productsQuery.refetch()}
                />
              </View>
            ) : productsQuery.fetchStatus === 'paused' && !productsQuery.data ? (
              <View style={styles.empty}>
                <AppText variant="bodyMuted" style={styles.emptyText}>
                  Connect to the internet to load products.
                </AppText>
                <Button
                  label="Retry"
                  compact
                  variant="secondary"
                  onPress={() => void productsQuery.refetch()}
                />
              </View>
            ) : (
              <View style={styles.empty}>
                <AppText variant="bodyMuted" style={styles.emptyText}>
                  {query ? 'No products match your search.' : 'No products are available.'}
                </AppText>
              </View>
            )
          }
          ListFooterComponent={
            productsQuery.isFetchingNextPage ? (
              <SkeletonGroup style={styles.loading}>
                <SkeletonCard lines={4} />
              </SkeletonGroup>
            ) : productsQuery.isFetchNextPageError ? (
              <View style={styles.more}>
                <AppText variant="small" style={styles.errorText}>
                  Could not load more products.
                </AppText>
                <Button
                  label="Load more"
                  compact
                  variant="secondary"
                  onPress={() => void productsQuery.fetchNextPage()}
                />
              </View>
            ) : undefined
          }
        />
      </PullToRefresh>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  top: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.sm },
  listContent: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.md,
    gap: spacing.sm,
    flexGrow: 1,
  },
  product: { padding: spacing.lg, gap: spacing.md },
  heading: { gap: spacing.xs },
  name: { flexShrink: 1 },
  detail: { gap: spacing.xs },
  detailLabel: { color: colors.muted },
  prices: { flexDirection: 'row', gap: spacing.sm },
  price: {
    flex: 1,
    gap: spacing.xs,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.ground,
    padding: spacing.md,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.dangerWash,
    padding: spacing.md,
  },
  errorText: { color: colors.danger, flexShrink: 1 },
  empty: { alignItems: 'center', gap: spacing.md, padding: spacing.xl },
  emptyText: { textAlign: 'center' },
  loading: { gap: spacing.sm },
  more: { alignItems: 'center', gap: spacing.sm, padding: spacing.md },
});
