/** Mirrors the FastAPI schemas (server/app/schemas.py). */

export type Role = 'BUYER' | 'SELLER' | 'BROKER';
export type CallPermission = 'EVERYONE' | 'CONVERSATIONS';
export type CallKind = 'AUDIO' | 'VIDEO';
export type CallStatus = 'RINGING' | 'ONGOING' | 'COMPLETED' | 'REJECTED' | 'MISSED' | 'CANCELLED';

export interface UserPublic {
  id: string;
  name: string;
  role: Role;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
}

export interface UserMe extends UserPublic {
  email: string;
  phone: string | null;
  show_online_status: boolean;
  allow_calls_from: CallPermission;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  user: UserMe;
}

export interface CallHistoryItem {
  id: string;
  kind: CallKind;
  status: CallStatus;
  direction: 'outgoing' | 'incoming';
  peer: UserPublic;
  created_at: string;
  duration_seconds: number | null;
}

export type ListingStatus = 'ACTIVE' | 'SOLD' | 'DRAFT';

export interface ListingImage {
  id: string;
  url: string;
  position: number;
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  price_inr: number;
  area_sqft: number | null;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  hide_exact_location: boolean;
  status: ListingStatus;
  owner: UserPublic;
  images: ListingImage[];
  is_owner: boolean;
  is_favorite: boolean;
  location_is_approximate: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListingPage {
  items: Listing[];
  total: number;
  limit: number;
  offset: number;
}

export type ListingInput = Pick<
  Listing,
  'title' | 'description' | 'price_inr' | 'area_sqft' | 'latitude' | 'longitude' | 'address' | 'city' | 'hide_exact_location'
>;

export type MessageType = 'TEXT' | 'SYSTEM' | 'CALL_LOG' | 'IMAGE';

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  type: MessageType;
  body: string;
  created_at: string;
  /** Client-only: optimistic messages before/after the server confirms them. */
  pending?: 'sending' | 'failed';
}

export interface Conversation {
  id: string;
  peer: UserPublic;
  peer_online: boolean | null;
  peer_last_read_at: string | null;
  listing: { id: string; title: string; price_inr: number; city: string | null; image_url: string | null } | null;
  last_message: ChatMessage | null;
  unread: number;
  updated_at: string;
}
