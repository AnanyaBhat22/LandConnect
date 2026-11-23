import { Ionicons } from '@expo/vector-icons';

import { EmptyState } from '../../components/ui';
import { colors } from '../../theme';

// Placeholder until listings are built (day 2 in the plan).
export default function CommunityScreen() {
  return (
    <EmptyState
      icon={<Ionicons name="map-outline" size={64} color={colors.secondary} />}
      title="Land listings are coming soon"
      subtitle="Browse plots with photos, prices and locations on a map."
    />
  );
}
