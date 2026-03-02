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

export interface CardViewProps extends ViewProps {
  environment?: 'sandbox' | 'production';
  paymentSessionID?: string;
  paymentSessionToken?: string;
  paymentSessionSecret?: string;
  publicKey?: string;
  handleSubmit?: (sessionData: SessionData) => Promise<ApiCallResult>;
  hasHandleSubmitListener?: boolean;
  onPaymentSuccess?: (event: { nativeEvent: { component: string; paymentId: string } }) => void;
  onPaymentError?: (event: { nativeEvent: { component: string; errorMessage: string; errorCode: string } }) => void;
}

const { CardModule } = NativeModules;

// Native component name must match the one returned by the Android ViewManager: RNCardView
const VIEW_NAME = 'RNCardView';

// Minimal Android-only wrapper; native-side onAfterUpdateTransaction ensures init after props are set
const NativeCardView: any = Platform.OS === 'android' ? requireNativeComponent(VIEW_NAME) : null;

export const CardView: React.FC<CardViewProps> = (props) => {
  const { handleSubmit, ...otherProps } = props;

  useEffect(() => {
    if (Platform.OS !== 'android' || !handleSubmit || !CardModule) {
      return;
    }

    const eventEmitter = new NativeEventEmitter(CardModule);

    const subscription = eventEmitter.addListener('onHandleSubmit', async (event) => {
      const { sessionData } = event;
      const { requestId, id, secret, sessionData: rawSessionData } = sessionData;

      try {
        const result = await handleSubmit({
          id,
          secret,
          sessionData: rawSessionData
        });

        CardModule.handleSubmitResponse(requestId, result.success, {
          ...result.data,
          error: result.error,
        });
      } catch (error) {
        console.error('❌ Error in JavaScript handleSubmit:', error);
        CardModule.handleSubmitResponse(requestId, false, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [handleSubmit]);

  if (Platform.OS !== 'android' || !NativeCardView) {
    return <View {...props} />;
  }
  
  // Pass hasHandleSubmitListener flag based on whether handleSubmit is provided
  return <NativeCardView {...otherProps} hasHandleSubmitListener={!!handleSubmit} />;
};

export default CardView;
