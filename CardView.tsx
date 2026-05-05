import React, { useEffect } from 'react';
import { requireNativeComponent, ViewProps, Platform, View, NativeEventEmitter, NativeModules } from 'react-native';
import { TokenizationResult, TokenizedCallbackResult } from './ApplePayView';

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
  showPayButton?: boolean;
  paymentSessionID?: string;
  paymentSessionToken?: string;
  paymentSessionSecret?: string;
  publicKey?: string;
  handleSubmit?: (sessionData: SessionData) => Promise<ApiCallResult>;
  hasHandleSubmitListener?: boolean;
  onTokenized?: (tokenizationResult: TokenizationResult) => Promise<TokenizedCallbackResult>;
  hasOnTokenizedListener?: boolean;
  onPaymentSuccess?: (event: { nativeEvent: { component: string; paymentId: string } }) => void;
  onPaymentError?: (event: { nativeEvent: { component: string; errorMessage: string; errorCode: string } }) => void;
  onPaymentChange?: (event: { component: string }) => void;
  onCardValidityChange?: (event: { isValid: boolean }) => void;
  onCardNativeHeight?: (event: { height: number }) => void;
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
  const { handleSubmit, onTokenized, onPaymentChange, onCardValidityChange, onCardNativeHeight, ...otherProps } = props;

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

  useEffect(() => {
    if (!onTokenized) return;

    if (Platform.OS === 'android' && CardModule) {
      const eventEmitter = new NativeEventEmitter(CardModule);
      const subscription = eventEmitter.addListener('onCardHandleTokenized', async (event) => {
        const { tokenizationData } = event;
        const { requestId, tokenizationResult } = tokenizationData ?? {};
        try {
          const result = await onTokenized(tokenizationResult as TokenizationResult);
          CardModule.handleTokenizedResponse(requestId, result.accepted, result.rejectionMessage);
        } catch (error) {
          console.error('❌ Error in JavaScript onTokenized (Card):', error);
          CardModule.handleTokenizedResponse(requestId, false, error instanceof Error ? error.message : 'Unknown error');
        }
      });
      return () => subscription.remove();
    }

    if (Platform.OS === 'ios' && ApplePayModule) {
      const eventEmitter = new NativeEventEmitter(ApplePayModule);
      const subscription = eventEmitter.addListener('onHandleTokenized', async (event) => {
        const { tokenizationData } = event;
        const { component, requestId, tokenizationResult } = tokenizationData ?? {};
        if (component !== 'card') return;
        try {
          const result = await onTokenized(tokenizationResult as TokenizationResult);
          ApplePayModule.handleTokenizedResponse(requestId, result.accepted, result.rejectionMessage);
        } catch (error) {
          console.error('❌ Error in JavaScript onTokenized (Card/iOS):', error);
          ApplePayModule.handleTokenizedResponse(requestId, false, error instanceof Error ? error.message : 'Unknown error');
        }
      });
      return () => subscription.remove();
    }

    return;
  }, [onTokenized]);

  useEffect(() => {
    if (!onPaymentChange) return;

    if (Platform.OS === 'android' && CardModule) {
      const eventEmitter = new NativeEventEmitter(CardModule);
      const subscription = eventEmitter.addListener('onFlowPaymentChange', (event) => {
        console.log('🔄 [CardView] onFlowPaymentChange (Android):', event);
        onPaymentChange({ component: event.component });
      });
      return () => subscription.remove();
    }

    if (Platform.OS === 'ios' && ApplePayModule) {
      const eventEmitter = new NativeEventEmitter(ApplePayModule);
      const subscription = eventEmitter.addListener('onFlowPaymentChange', (event) => {
        console.log('🔄 [CardView] onFlowPaymentChange (iOS):', event);
        onPaymentChange({ component: event.component });
      });
      return () => subscription.remove();
    }

    return;
  }, [onPaymentChange]);

  useEffect(() => {
    if (!onCardValidityChange) return;

    if (Platform.OS === 'android' && CardModule) {
      const eventEmitter = new NativeEventEmitter(CardModule);
      const subscription = eventEmitter.addListener('onCardValidityChange', (event) => {
        console.log('🔎 [CardView] onCardValidityChange (Android):', event);
        onCardValidityChange({ isValid: !!event.isValid });
      });
      return () => subscription.remove();
    }

    if (Platform.OS === 'ios' && ApplePayModule) {
      const eventEmitter = new NativeEventEmitter(ApplePayModule);
      const subscription = eventEmitter.addListener('onCardValidityChange', (event) => {
        console.log('🔎 [CardView] onCardValidityChange (iOS):', event);
        onCardValidityChange({ isValid: !!event.isValid });
      });
      return () => subscription.remove();
    }

    return;
  }, [onCardValidityChange]);

  useEffect(() => {
    if (!onCardNativeHeight) return;

    if (Platform.OS === 'android' && CardModule) {
      const eventEmitter = new NativeEventEmitter(CardModule);
      const subscription = eventEmitter.addListener('onCardNativeHeight', (event) => {
        const next = Number(event?.height ?? 0);
        if (Number.isFinite(next) && next > 0) {
          onCardNativeHeight({ height: next });
        }
      });
      return () => subscription.remove();
    }

    if (Platform.OS === 'ios' && ApplePayModule) {
      const eventEmitter = new NativeEventEmitter(ApplePayModule);
      const subscription = eventEmitter.addListener('onCardNativeHeight', (event) => {
        if (event?.component && event.component !== 'card') return;
        const next = Number(event?.height ?? 0);
        if (Number.isFinite(next) && next > 0) {
          onCardNativeHeight({ height: next });
        }
      });
      return () => subscription.remove();
    }

    return;
  }, [onCardNativeHeight]);

  if (Platform.OS === 'android' && NativeCardViewAndroid) {
    return <NativeCardViewAndroid {...otherProps} hasHandleSubmitListener={!!handleSubmit} hasOnTokenizedListener={!!onTokenized} />;
  }

  if (Platform.OS === 'ios' && NativeCardViewIOS) {
    return (
      <NativeCardViewIOS
        {...otherProps}
        paymentMethod="card"
        hasHandleSubmitListener={!!handleSubmit}
        hasOnTokenizedListener={!!onTokenized}
      />
    );
  }

  if (!NativeCardViewAndroid && !NativeCardViewIOS) {
    return <View {...props} />;
  }

  return <View {...props} />;
};

export default CardView;
