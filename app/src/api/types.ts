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
