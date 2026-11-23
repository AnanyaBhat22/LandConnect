/**
 * LandConnect brand palette, taken from the company's own logo and banner:
 * a near-black forest green background, an emerald logo tile, a mint
 * "Connect" wordmark, a pale-mint shape and a small amber dot.
 *
 * The *layout* follows WhatsApp's familiar patterns (coloured header, tabs,
 * chat bubbles, call screens); the colours are LandConnect's. Call
 * Accept/Decline stay green/red because those meanings are universal.
 */
export const colors = {
  header: '#12251E', // brand dark forest: headers, call screens
  primary: '#167A5B', // brand emerald (logo tile): buttons, prices, active tabs
  secondary: '#3FAE86', // between emerald and mint: links, toggles, section titles
  mint: '#5FD1A2', // "Connect" mint: highlights on dark backgrounds
  paleMint: '#A9D3C3', // logo's second shape
  accent: '#F2A12E', // the amber dot: floating buttons, badges, send
  sand: '#EEF6F2', // light mint-tinted surface for cards
  success: '#2FB36D', // accept call, online, outgoing-call arrow
  danger: '#E5484D', // decline, end call, missed
  background: '#FFFFFF',
  surface: '#EEF6F2',
  border: '#DCE9E3',
  text: '#13201B',
  textMuted: '#66756F',
  white: '#FFFFFF',
  bubbleMine: '#DDF3E9',
  callBackground: '#0D1C16',
};

export const roleColors: Record<string, string> = {
  BUYER: '#2B6CB0',
  SELLER: '#167A5B',
  BROKER: '#9C4F96',
};

/** Rounded geometric face close to the LandConnect wordmark (loaded in the root layout). */
export const fonts = {
  brand: 'Comfortaa_700Bold',
  heading: 'Comfortaa_600SemiBold',
};
