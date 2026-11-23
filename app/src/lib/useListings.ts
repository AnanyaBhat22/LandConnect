import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { api } from '../api/client';
import type { Listing, ListingPage } from '../api/types';

/** Loads a listing query, reloads when the screen regains focus, and supports optimistic favourites. */
export function useListings(params: Record<string, string | number | boolean | undefined>) {
  const [items, setItems] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const all: Record<string, string | number | boolean | undefined> = { limit: 100, ...params };
  const query = new URLSearchParams(
    Object.entries(all)
      .filter(([, v]) => v !== undefined && v !== '' && v !== false)
      .map(([k, v]) => [k, String(v)]),
  ).toString();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api<ListingPage>(`/listings?${query}`);
      setItems(page.items);
      setTotal(page.total);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const toggleFavorite = useCallback(async (listing: Listing) => {
    const next = !listing.is_favorite;
    setItems((list) => list.map((l) => (l.id === listing.id ? { ...l, is_favorite: next } : l)));
    try {
      await api(`/listings/${listing.id}/favorite`, { method: next ? 'POST' : 'DELETE' });
    } catch {
      setItems((list) => list.map((l) => (l.id === listing.id ? { ...l, is_favorite: !next } : l))); // roll back
    }
  }, []);

  return { items, total, loading, error, reload: load, toggleFavorite };
}
