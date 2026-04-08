import React, { useEffect } from 'react';
import {
  requireNativeComponent,
  ViewProps,
  Platform,
  View,
  NativeEventEmitter,
  NativeModules,
  NativeModule,
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

export interface TokenizationResult {
  token: string;
  type: string;
  expiresOn: string;
  expiryMonth: number;
  expiryYear: number;
  last4: string;
  bin: string;
  scheme?: string;
  schemeLocal?: string;
  cardType?: string;
  cardCategory?: string;
  issuer?: string;
  issuerCountry?: string;
  productId?: string;
  productType?: string;
  name?: string;
  cvv?: string;
  billingAddress?: {
    country: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  phone?: {
    number: string;
    countryCode: string;
  };
  preferredScheme?: string;
  cardMetadata?: {
    bin: string;
    scheme: string;
    localSchemes?: string[];
    cardType?: string;
    cardCategory?: string;
    currency?: string;
    issuer?: string;
    issuerCountry?: string;
    issuerCountryName?: string;
    productId?: string;
    productType?: string;
  };
}

export interface TokenizedCallbackResult {
  accepted: boolean;
  rejectionMessage?: string;
}

export interface ApplePayViewProps extends ViewProps {
  environment?: 'sandbox' | 'production';
  paymentSessionID?: string;
  paymentSessionToken?: string; // kept for parity with GooglePayView
  paymentSessionSecret?: string;
  publicKey?: string;
  merchantIdentifier?: string; // iOS Apple Pay merchant ID
  showPayButton?: boolean;
  handleSubmit?: (sessionData: SessionData) => Promise<ApiCallResult>;
  hasHandleSubmitListener?: boolean;
  onTokenized?: (tokenizationResult: TokenizationResult) => Promise<TokenizedCallbackResult>;
  hasOnTokenizedListener?: boolean;
  onPaymentSuccess?: (event: { nativeEvent: { component: string; paymentId: string } }) => void;
  onPaymentError?: (event: { nativeEvent: { component: string; errorMessage: string; errorCode: string } }) => void;
}

type ApplePayNativeModule = {
  handleSubmitResponse: (requestId: string, success: boolean, data?: Record<string, any>) => void;
  handleTokenizedResponse: (requestId: string, accepted: boolean, rejectionMessage?: string) => void;
  submit?: (paymentSessionID: string) => Promise<{ success: boolean }>;
  addListener?: (eventName: string) => void;
  removeListeners?: (count: number) => void;
};

const { ApplePayModule } = NativeModules as { ApplePayModule?: ApplePayNativeModule };

export const submitApplePay = (paymentSessionID: string): Promise<{ success: boolean }> => {
  if (Platform.OS !== 'ios' || !ApplePayModule?.submit) {
    return Promise.reject(new Error('ApplePay submit is only available on iOS with native module loaded'));
  }
  return ApplePayModule.submit(paymentSessionID);
};

// Native component name must match the iOS ViewManager: RNApplePayView
const VIEW_NAME = 'RNApplePayView';
const IOS_NATIVE_VIEW_CACHE_KEY = '__RN_NATIVE_VIEW_RNApplePayView__';

// Minimal iOS-only wrapper; native-side should initialize after props are set
const NativeApplePayView: any = Platform.OS === 'ios'
  ? ((globalThis as any)[IOS_NATIVE_VIEW_CACHE_KEY] ??
      (((globalThis as any)[IOS_NATIVE_VIEW_CACHE_KEY] = requireNativeComponent(VIEW_NAME))))
  : null;

export const ApplePayView: React.FC<ApplePayViewProps> = (props) => {
  const { handleSubmit, onTokenized, ...otherProps } = props;

  useEffect(() => {
    // Bridge event to receive submit requests from native
    if (Platform.OS !== 'ios' || !handleSubmit || !ApplePayModule) return;

    const eventEmitter = new NativeEventEmitter(ApplePayModule as NativeModule);
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

  useEffect(() => {
    if (Platform.OS !== 'ios' || !onTokenized || !ApplePayModule) return;

    const eventEmitter = new NativeEventEmitter(ApplePayModule as NativeModule);
    const subscription = eventEmitter.addListener('onHandleTokenized', async (event) => {
      const { tokenizationData } = event;
      const { component, requestId, tokenizationResult } = tokenizationData ?? {};

      if (component !== 'applepay') {
        return;
      }

      console.debug('[ApplePayView] onHandleTokenized event received', { requestId });

      try {
        const result = await onTokenized(tokenizationResult as TokenizationResult);
        console.debug('[ApplePayView] JS onTokenized result', { requestId, accepted: result.accepted });
        ApplePayModule.handleTokenizedResponse(requestId, result.accepted, result.rejectionMessage);
      } catch (error) {
        console.error('[ApplePayView] Error in JS onTokenized (Apple Pay):', error);
        ApplePayModule.handleTokenizedResponse(requestId, false, error instanceof Error ? error.message : 'Unknown error');
      }
    });

    return () => subscription.remove();
  }, [onTokenized]);

  if (Platform.OS !== 'ios' || !NativeApplePayView) {
    return <View {...props} />;
  }
  return (
    <NativeApplePayView
      {...otherProps}
      paymentMethod="applepay"
      hasHandleSubmitListener={!!handleSubmit}
      hasOnTokenizedListener={!!onTokenized}
    />
  );
};

export default ApplePayView;
