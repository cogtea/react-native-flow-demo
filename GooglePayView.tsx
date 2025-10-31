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
  handleSubmit?: (sessionData: SessionData) => Promise<ApiCallResult>;
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
    // Set up event listener to receive submit requests from native
    
    if (Platform.OS !== 'android' || !handleSubmit || !GooglePayModule) {
      return;
    }

    const eventEmitter = new NativeEventEmitter(GooglePayModule);
    
    const subscription = eventEmitter.addListener('onHandleSubmit', async (event) => {
      const { sessionData } = event;
      const { requestId, id, secret, sessionData: rawSessionData } = sessionData;

      try {
        // Call the JavaScript handleSubmit function with the raw session data
        const result = await handleSubmit({ 
          id, 
          secret, 
          sessionData: rawSessionData // Pass the actual session data for /submit
        });
        
        // Send response back to native
        GooglePayModule.handleSubmitResponse(requestId, result.success, {
          ...result.data,
          error: result.error,
        });
      } catch (error) {
        console.error('❌ Error in JavaScript handleSubmit:', error);
        // Send error response back to native
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
    // iOS or if native view isn't available, render a harmless placeholder to keep layout stable
    return <View {...props} />;
  }
  return <NativeGooglePayView {...otherProps} />;
};

export default GooglePayView;
