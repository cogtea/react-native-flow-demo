import React, { useEffect } from 'react';
import {
  requireNativeComponent,
  ViewProps,
  Platform,
  View,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';

export interface SessionData {
  id: string;
  secret: string;
  sessionData?: string; // Raw session data from SDK
}

export interface ApiCallResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface ApplePayViewProps extends ViewProps {
  environment?: 'sandbox' | 'production';
  paymentSessionID?: string;
  paymentSessionToken?: string; // kept for parity with GooglePayView
  paymentSessionSecret?: string;
  publicKey?: string;
  merchantIdentifier?: string; // iOS Apple Pay merchant ID
  handleSubmit?: (sessionData: SessionData) => Promise<ApiCallResult>;
  hasHandleSubmitListener?: boolean;
  onPaymentSuccess?: (event: { nativeEvent: { component: string; paymentId: string } }) => void;
  onPaymentError?: (event: { nativeEvent: { component: string; errorMessage: string; errorCode: string } }) => void;
}

const { ApplePayModule } = NativeModules as { ApplePayModule?: any };

// Native component name must match the iOS ViewManager: RNApplePayView
const VIEW_NAME = 'RNApplePayView';
const IOS_NATIVE_VIEW_CACHE_KEY = '__RN_NATIVE_VIEW_RNApplePayView__';

// Minimal iOS-only wrapper; native-side should initialize after props are set
const NativeApplePayView: any = Platform.OS === 'ios'
  ? ((globalThis as any)[IOS_NATIVE_VIEW_CACHE_KEY] ??
      (((globalThis as any)[IOS_NATIVE_VIEW_CACHE_KEY] = requireNativeComponent(VIEW_NAME))))
  : null;

export const ApplePayView: React.FC<ApplePayViewProps> = (props) => {
  const { handleSubmit, ...otherProps } = props;

  useEffect(() => {
    // Bridge event to receive submit requests from native
    if (Platform.OS !== 'ios' || !handleSubmit || !ApplePayModule) return;

    const eventEmitter = new NativeEventEmitter(ApplePayModule);
    const subscription = eventEmitter.addListener('onHandleSubmit', async (event) => {
      const { sessionData } = event;
      const { component, requestId, id, secret, sessionData: rawSessionData } = sessionData ?? {};

      if (component !== 'applepay') {
        return;
      }

      console.debug('[ApplePayView] onHandleSubmit event received', { requestId, id, hasSessionData: !!rawSessionData });

      try {
        const result = await handleSubmit({ id, secret, sessionData: rawSessionData });
        console.debug('[ApplePayView] JS handleSubmit result', { requestId, success: result.success, error: result.error });
        ApplePayModule.handleSubmitResponse(requestId, result.success, {
          ...result.data,
          error: result.error,
        });
      } catch (error) {
        console.error('[ApplePayView] Error in JS handleSubmit (Apple Pay):', error);
        ApplePayModule.handleSubmitResponse(requestId, false, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    return () => subscription.remove();
  }, [handleSubmit]);

  if (Platform.OS !== 'ios' || !NativeApplePayView) {
    return <View {...props} />;
  }
  return (
    <NativeApplePayView
      {...otherProps}
      paymentMethod="applepay"
      hasHandleSubmitListener={!!handleSubmit}
    />
  );
};

export default ApplePayView;
