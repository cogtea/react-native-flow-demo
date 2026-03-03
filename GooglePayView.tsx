import React, { useEffect } from 'react';
import { requireNativeComponent, ViewProps, Platform, View, NativeEventEmitter, NativeModules } from 'react-native';

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

export interface GooglePayViewProps extends ViewProps {
  environment?: 'sandbox' | 'production';
  paymentSessionID?: string;
  paymentSessionToken?: string;
  paymentSessionSecret?: string;
  publicKey?: string;
  showPayButton?: boolean;
  handleSubmit?: (sessionData: SessionData) => Promise<ApiCallResult>;
  hasHandleSubmitListener?: boolean;
  onPaymentSuccess?: (event: { nativeEvent: { component: string; paymentId: string } }) => void;
  onPaymentError?: (event: { nativeEvent: { component: string; errorMessage: string; errorCode: string } }) => void;
}

const { GooglePayModule } = NativeModules;

// Native component name must match the one returned by the Android ViewManager: RNGooglePayView
const VIEW_NAME = 'RNGooglePayView';

// Minimal Android-only wrapper; native-side onAfterUpdateTransaction ensures init after props are set
const NativeGooglePayView: any = Platform.OS === 'android' ? requireNativeComponent(VIEW_NAME) : null;

export const GooglePayView: React.FC<GooglePayViewProps> = (props) => {
  const { handleSubmit, ...otherProps } = props;

  useEffect(() => {
    if (Platform.OS !== 'android' || !handleSubmit || !GooglePayModule) {
      return;
    }

    const eventEmitter = new NativeEventEmitter(GooglePayModule);

    const subscription = eventEmitter.addListener('onHandleSubmit', async (event) => {
      const { sessionData } = event;
      const { requestId, id, secret, sessionData: rawSessionData } = sessionData;

      try {
        const result = await handleSubmit({
          id,
          secret,
          sessionData: rawSessionData
        });

        GooglePayModule.handleSubmitResponse(requestId, result.success, {
          ...result.data,
          error: result.error,
        });
      } catch (error) {
        console.error('❌ Error in JavaScript handleSubmit:', error);
        GooglePayModule.handleSubmitResponse(requestId, false, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [handleSubmit]);

  if (Platform.OS !== 'android' || !NativeGooglePayView) {
    return <View {...props} />;
  }
  return <NativeGooglePayView {...otherProps} hasHandleSubmitListener={!!handleSubmit} />;
};

/* -------------------------------------------------------
 * NEW: Check Google Pay availability
 * ----------------------------------------------------- */
export async function isGooglePayAvailable(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    if (!GooglePayModule || !GooglePayModule.isGooglePayAvailable) {
      console.warn('GooglePayModule.isGooglePayAvailable is not implemented natively.');
      return false;
    }
    return await GooglePayModule.isGooglePayAvailable();
  } catch (e) {
    console.warn('Google Pay availability check error:', e);
    return false;
  }
}

export async function submitGooglePay(paymentSessionID: string): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    if (!GooglePayModule || !GooglePayModule.submit) {
      console.warn('GooglePayModule.submit is not implemented natively.');
      return false;
    }
    return await GooglePayModule.submit(paymentSessionID);
  } catch (e) {
    console.warn('Google Pay submit error:', e);
    return false;
  }
}

export default GooglePayView;