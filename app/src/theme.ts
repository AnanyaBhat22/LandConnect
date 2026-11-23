/**
 * LandConnect palette: earthy and land-inspired (pine, terracotta, sand).
 *
 * The *layout* follows WhatsApp's familiar patterns (coloured header, tabs,
 * chat bubbles, call screens), but the colours are our own brand, so the app
 * doesn't look like a WhatsApp clone. Call Accept/Decline stay green/red
 * because those meanings are universal.
 */
export const colors = {
  primary: '#1F3B2F', // deep pine: headers, primary buttons
  secondary: '#3E7C5A', // field green: links, active toggles, section titles
  accent: '#D9824B', // terracotta: floating buttons, badges, send
  sand: '#F5EFE6', // warm background for cards and surfaces
  success: '#2FB36D', // accept call, online, outgoing-call arrow
  danger: '#E5484D', // decline, end call, missed
  background: '#FFFFFF',
  surface: '#F5EFE6',
  border: '#E8E1D6',
  text: '#1C1A17',
  textMuted: '#77706A',
  white: '#FFFFFF',
  bubbleMine: '#E3EFE6',
  callBackground: '#101A16',
};

export const roleColors: Record<string, string> = {
  BUYER: '#2B6CB0',
  SELLER: '#3E7C5A',
  BROKER: '#9C4F96',
};
