/**
 * Current on-screen keyboard height (0 when hidden).
 *
 * Why: Android 15 / Expo SDK 58 run apps edge-to-edge, where the keyboard
 * overlays the window instead of resizing it, so KeyboardAvoidingView's
 * 'height' mode does nothing and inputs at the bottom get covered. Listening
 * to the keyboard events and padding by its height works in every mode and
 * needs no extra native library.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
