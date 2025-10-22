import React from 'react';
import { requireNativeComponent, ViewProps, Platform, View } from 'react-native';

export interface GooglePayViewProps extends ViewProps {
  paymentSessionID?: string;
  paymentSessionToken?: string;
  paymentSessionSecret?: string;
  publicKey?: string;
}

// Native component name must match the one returned by the Android ViewManager: RNGooglePayView
const VIEW_NAME = 'RNGooglePayView';

// Minimal Android-only wrapper; native-side onAfterUpdateTransaction ensures init after props are set
const NativeGooglePayView: any = Platform.OS === 'android' ? requireNativeComponent(VIEW_NAME) : null;

export const GooglePayView: React.FC<GooglePayViewProps> = (props) => {
  if (Platform.OS !== 'android' || !NativeGooglePayView) {
    // iOS or if native view isn't available, render a harmless placeholder to keep layout stable
    return <View {...props} />;
  }
  return <NativeGooglePayView {...props} />;
};

export default GooglePayView;
