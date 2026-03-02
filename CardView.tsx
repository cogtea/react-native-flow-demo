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
const { ApplePayModule } = NativeModules;
const CARD_HANDLE_SUBMIT_EVENT = 'onCardHandleSubmit';
const APPLE_PAY_HANDLE_SUBMIT_EVENT = 'onHandleSubmit';

const ANDROID_VIEW_NAME = 'RNCardView';
const IOS_VIEW_NAME = 'RNCardView';

const NativeCardViewAndroid: any = Platform.OS === 'android' ? requireNativeComponent(ANDROID_VIEW_NAME) : null;
const NativeCardViewIOS: any = Platform.OS === 'ios' ? requireNativeComponent(IOS_VIEW_NAME) : null;

export const CardView: React.FC<CardViewProps> = (props) => {
  const { handleSubmit, ...otherProps } = props;

  useEffect(() => {
    if (!handleSubmit) {
      return;
    }

    if (Platform.OS === 'android' && CardModule) {
      const eventEmitter = new NativeEventEmitter(CardModule);

      const subscription = eventEmitter.addListener(CARD_HANDLE_SUBMIT_EVENT, async (event) => {
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
    }

    if (Platform.OS === 'ios' && ApplePayModule) {
      const eventEmitter = new NativeEventEmitter(ApplePayModule);

      const subscription = eventEmitter.addListener(APPLE_PAY_HANDLE_SUBMIT_EVENT, async (event) => {
        const { sessionData } = event;
        const { component, requestId, id, secret, sessionData: rawSessionData } = sessionData ?? {};

        if (component !== 'card') {
          return;
        }

        try {
          const result = await handleSubmit({
            id,
            secret,
            sessionData: rawSessionData
          });

          ApplePayModule.handleSubmitResponse(requestId, result.success, {
            ...result.data,
            error: result.error,
          });
        } catch (error) {
          console.error('❌ Error in JavaScript handleSubmit:', error);
          ApplePayModule.handleSubmitResponse(requestId, false, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });

      return () => {
        subscription.remove();
      };
    }

    return;
  }, [handleSubmit]);

  if (Platform.OS === 'android' && NativeCardViewAndroid) {
    return <NativeCardViewAndroid {...otherProps} hasHandleSubmitListener={!!handleSubmit} />;
  }

  if (Platform.OS === 'ios' && NativeCardViewIOS) {
    return (
      <NativeCardViewIOS
        {...otherProps}
        paymentMethod="card"
        hasHandleSubmitListener={!!handleSubmit}
      />
    );
  }

  if (!NativeCardViewAndroid && !NativeCardViewIOS) {
    return <View {...props} />;
  }

  return <View {...props} />;
};

export default CardView;
