import { Platform, TurboModuleRegistry, UIManager } from 'react-native';

/**
 * True when @react-native-community/datetimepicker is linked in this binary
 * (CUTLY utils/canUseNativeTimePicker.ts). Probe only — never getEnforcing.
 */
export function canUseNativeTimePicker(): boolean {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    return (
      TurboModuleRegistry.get('RNCTimePicker') != null ||
      TurboModuleRegistry.get('RNCDatePicker') != null
    );
  }
  if (Platform.OS === 'ios') {
    return (
      UIManager.getViewManagerConfig?.('RNDateTimePicker') != null ||
      UIManager.hasViewManagerConfig?.('RNDateTimePicker') === true
    );
  }
  return false;
}
