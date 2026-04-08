import React, { useCallback, useEffect, useState } from 'react';
import {
  SafeAreaView,
  Button,
  ScrollView,
  StyleSheet,
  Platform,
  Text,
  View,
  Pressable,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';

import GooglePayView, { SessionData, ApiCallResult, isGooglePayAvailable } from './GooglePayView';
import CardView from './CardView';
import ApplePayView, { submitApplePay, TokenizationResult, TokenizedCallbackResult } from './ApplePayView';

const { FlowModule, CheckoutFlowManager, ApplePayModule } = NativeModules as any;

let publicKey = 'pk_sbox_u57rqbpjsrmyjpyrycxk42jbnuz'; // Replace with your real public key
const merchantIdentifier = 'merchant.com.joelle.flowmobile'; // Replace with your merchant ID

function App(): React.JSX.Element {
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [isApplePayJsButtonDisabled, setIsApplePayJsButtonDisabled] = useState(false);
  const [showingFlow, setShowingFlow] = useState(false);
  const [flowRenderKey, setFlowRenderKey] = useState(0);
  const [paymentSession, setPaymentSession] = useState({
    id: '',
    token: '',
    secret: '',
  });
  const isSessionReady =
    paymentSession.id.trim().length > 0 &&
    paymentSession.secret.trim().length > 0;

  const handleTokenized = useCallback(async (tokenizationResult: TokenizationResult): Promise<TokenizedCallbackResult> => {
    const schemeLocal = tokenizationResult.schemeLocal?.toLowerCase();
    const localSchemes = tokenizationResult.cardMetadata?.localSchemes?.map(s => s.toLowerCase()) ?? [];

    const isMada = schemeLocal === 'mada' || localSchemes.includes('mada');

    if (isMada) {
      setStatus('Declined');
      setError('Mada cards are not supported.');
      return { accepted: false, rejectionMessage: 'Mada cards are not supported.' };
    }

    return { accepted: true };
  }, []);

  const handleSubmit = useCallback(async (sessionData: SessionData): Promise<ApiCallResult> => {
    setStatus('Submitting payment...');
    try {
      console.debug('[App] handleSubmit called', { id: sessionData.id, hasSessionData: !!sessionData.sessionData });
      // Ensure we have the raw session data
      if (!sessionData.sessionData) {
        throw new Error('No session data available for submission');
      }

      // Make the API call to checkout.com to submit the modified payment session
      // Using the raw session data from the SDK (not id/secret)
      // IMPORTANT: Replace 'YOUR_SECRET_KEY' with your actual Checkout.com secret key
      const response = await fetch(`https://api.sandbox.checkout.com/payment-sessions/${sessionData.id}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer sk_sbox_dlqbu36qaj2ee76vso5vddm4vac',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_data: sessionData.sessionData,
          "3ds": {
            enabled: true
          }
        }),
      });

      const responseText = await response.text();
      let responseData: any = null;
      try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }
      console.debug('[App] payment submit response', { status: response.status, ok: response.ok, responseData });

      if (response.ok) {
        if (responseData.status === 'Action Required' && responseData.action?.type === '3ds') {
          setStatus('3DS Authentication required...');
          setShowingFlow(true);
        } else {
          setStatus(`Success: ${responseData.id || 'Payment completed'}`);
          setShowingFlow(false);
        }
        setError(null);

        return {
          success: true,
          data: {
            response: JSON.stringify(responseData), // Send response as JSON string
            paymentId: responseData.id,
            status: responseData.status,
            action: responseData.action,
          },
        };
      } else {
        setStatus('Error');
        setError(`Payment failed: ${responseData.message || JSON.stringify(responseData) || 'Unknown error'}`);
        setShowingFlow(false);
        return {
          success: false,
          error: responseData.message || 'Payment submission failed',
        };
      }
    } catch (error) {
      setStatus('Error');
      setError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setShowingFlow(false);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }, []);

  useEffect(() => {
    // Subscribe to success/error from platform-native modules
    const subs: Array<{ remove: () => void } | undefined> = [];

    try {
      // Android Flow module (for Google Pay success/error)
      if (FlowModule && Platform.OS === 'android') {
        const emitter = new NativeEventEmitter(FlowModule);
        subs.push(
          emitter.addListener('onFlowPaymentSuccess', (data: any) => {
            setStatus(`Success: ${data.paymentId}`);
            setError(null);
            setShowingFlow(false);
          }),
          emitter.addListener('onFlowPaymentError', (errorData: any) => {
            setStatus('Error');
            setError(`Error from ${errorData.component}: ${errorData.errorMessage}`);
            setShowingFlow(false);
          })
        );
      }

      // iOS CheckoutFlowManager (if used elsewhere)
      if (CheckoutFlowManager && Platform.OS === 'ios') {
        const emitter = new NativeEventEmitter(CheckoutFlowManager);
        subs.push(
          emitter.addListener('onFlowPaymentSuccess', (data: any) => {
            setStatus(`Success: ${data.paymentId}`);
            setError(null);
            setShowingFlow(false);
          }),
          emitter.addListener('onFlowPaymentError', (errorData: any) => {
            setStatus('Error');
            setError(`Error from ${errorData.component}: ${errorData.errorMessage}`);
            setShowingFlow(false);
          })
        );
      }

      // iOS ApplePayModule events from ApplePayView
      if (ApplePayModule && Platform.OS === 'ios') {
        const emitter = new NativeEventEmitter(ApplePayModule);
        subs.push(
          emitter.addListener('onFlowPaymentSuccess', (data: any) => {
            setStatus(`Success: ${data.paymentId}`);
            setError(null);
            setShowingFlow(false);
          }),
          emitter.addListener('onFlowPaymentError', (errorData: any) => {
            setStatus('Error');
            setError(`Error from ${errorData.component}: ${errorData.errorMessage}`);
            setShowingFlow(false);
          })
        );
      }
    } catch (_e) {
      // In non-native environments (e.g., Jest), NativeEventEmitter may not be constructible.
    }

    return () => {
      subs.forEach(s => s?.remove?.());
    };
  }, []);

  useEffect(() => {
    if (!showingFlow || !isSessionReady) return;
    const timer = setTimeout(() => {
      setFlowRenderKey(prev => prev + 1);
    }, 120);
    return () => clearTimeout(timer);
  }, [showingFlow, isSessionReady, paymentSession.id]);



  const startPayment = async () => {
    setStatus('Processing...');
    setError(null);

    const googlePayAvailable = await isGooglePayAvailable();
    console.debug('[App] isGooglePayAvailable:', googlePayAvailable);
    try {
      // IMPORTANT: Replace 'YOUR_SECRET_KEY' with your actual Checkout.com secret key
      const response = await fetch('https://api.sandbox.checkout.com/payment-sessions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer sk_sbox_dlqbu36qaj2ee76vso5vddm4vac',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: 1000,
          currency: 'AED',
          reference: 'ORD-123A',
          processing_channel_id: 'pc_6biffo54jgnufis4jenkhioawa',
          billing: {
            address: {
              country: 'AE',
            },
          },
          "3ds": {
            enabled: true,
          },
          customer: {
            name: 'Jia Tsang',
            email: 'jia.tsang@example.com',
            phone: {
              country_code: '965',
              number: '97620030',
            },
          },
          success_url: 'https://example.com/payments/success',
          failure_url: 'https://example.com/payments/failure',
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const { id, payment_session_token, payment_session_secret } = data;

      setPaymentSession({
        id,
        token: payment_session_token,
        secret: payment_session_secret,
      });
      setIsApplePayJsButtonDisabled(false);

      setStatus('Payment flow started');
      setShowingFlow(true);


    } catch (error) {
      setError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setStatus('Error');
      setShowingFlow(false);
    }
  };

  const submitApplePayFromJS = async () => {
    if (Platform.OS !== 'ios') {
      return;
    }

    if (!paymentSession.id) {
      setStatus('Error');
      setError('No payment session available for Apple Pay submit');
      return;
    }

    try {
      setIsApplePayJsButtonDisabled(true);
      setStatus('Submitting Apple Pay from JS...');
      await submitApplePay(paymentSession.id);
      setStatus('Apple Pay submit requested');
      setError(null);
    } catch (submitError) {
      setStatus('Error');
      setError(`Apple Pay submit error: ${submitError instanceof Error ? submitError.message : String(submitError)}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>

      {showingFlow ? (
        <View style={styles.containerFlow}>
          {/* GooglePay/ApplePay button on top */}
          <View style={styles.payButtonContainer}>
            {Platform.OS === 'ios' ? (
              <View style={styles.iosApplePayContainer}>
                <ApplePayView
                  style={{ width: '100%', height: 60 }}
                  paymentSessionID={paymentSession.id}
                  paymentSessionToken={paymentSession.token}
                  paymentSessionSecret={paymentSession.secret}
                  publicKey={publicKey}
                  merchantIdentifier={merchantIdentifier}
                  environment="sandbox"
                  showPayButton={false}
                  handleSubmit={handleSubmit}
                  onTokenized={handleTokenized}
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.applePayBrandButton,
                    isApplePayJsButtonDisabled && styles.applePayBrandButtonDisabled,
                    pressed && styles.applePayBrandButtonPressed,
                  ]}
                  onPress={submitApplePayFromJS}
                  disabled={isApplePayJsButtonDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Apple Pay"
                >
                  <Text style={styles.applePayBrandText}> Pay</Text>
                </Pressable>
              </View>
            ) : (
              <GooglePayView
                style={{ width: '100%', height: 60 }}
                paymentSessionID={paymentSession.id}
                paymentSessionToken={paymentSession.token}
                paymentSessionSecret={paymentSession.secret}
                publicKey={publicKey}
                environment="sandbox"
                handleSubmit={handleSubmit}
              />
            )}
          </View>

          {/* Card form below in ScrollView */}
          <ScrollView style={styles.flowContainer}>
            <View style={styles.paymentMethodContainer}>
              {isSessionReady ? (
                <CardView
                  key={`card-${flowRenderKey}`}
                  style={styles.cardView}
                  paymentSessionID={paymentSession.id}
                  paymentSessionToken={paymentSession.token}
                  paymentSessionSecret={paymentSession.secret}
                  publicKey={publicKey}
                  environment="sandbox"
                  hasHandleSubmitListener={true}
                  //handleSubmit={handleSubmit}
                />
              ) : (
                <View style={styles.loadingContainer}>
                  <Text>Preparing payment form...</Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      ) : (
        <>
          <Text style={styles.title}>Checkout.com Flow Demo</Text>

          <View style={styles.statusContainer}>
            <Text>Status: </Text>
            <Text
              style={
                status.startsWith('Success') ? styles.successText :
                  status === 'Error' ? styles.errorText :
                    status === 'Processing...' ? styles.processingText :
                      styles.readyText
              }
            >
              {status}
            </Text>
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.moduleInfoContainer}>
            <Text>iOS Module: {CheckoutFlowManager ? '✅ Available' : '❌ Missing'}</Text>
            <Text>Android Module: {FlowModule ? '✅ Available' : '❌ Missing'}</Text>
            <Text>ApplePayModule: {ApplePayModule ? '✅ Available' : '❌ Missing'}</Text>
            <Text>Current Platform: {Platform.OS}</Text>
          </View>

          <Button
            title="Start Payment Session"
            onPress={startPayment}
            disabled={status === 'Processing...'}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20},
  containerFlow: { flex: 1, width: '100%', backgroundColor: '#fff' },
  payButtonContainer: { 
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  iosApplePayContainer: {
    width: '100%',
    gap: 12,
  },
  applePayBrandButton: {
    height: 50,
    borderRadius: 10,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applePayBrandButtonPressed: {
    opacity: 0.85,
  },
  applePayBrandButtonDisabled: {
    opacity: 0.45,
  },
  applePayBrandText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  flowContainer: { flex: 1, width: '100%' },
  paymentMethodContainer: { padding: 20 },
  cardView: { width: '100%', height: 700 },
  loadingContainer: { 
    height: 400, 
    alignItems: 'center', 
    justifyContent: 'center',
    backgroundColor: '#f9f9f9',
  },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
  statusContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  errorContainer: {
    backgroundColor: '#ffeeee',
    padding: 10,
    borderRadius: 5,
    marginBottom: 20,
    width: '100%',
  },
  moduleInfoContainer: {
    backgroundColor: '#f0f0f0',
    padding: 10,
    borderRadius: 5,
    marginBottom: 20,
    width: '100%',
  },
  successText: { color: 'green', fontWeight: 'bold' },
  errorText: { color: 'red', fontWeight: 'bold' },
  processingText: { color: 'blue', fontWeight: 'bold' },
  readyText: { color: 'black' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  instructions: {
    fontSize: 14,
    color: '#555',
    marginTop: 10,
    textAlign: 'center',
  },
});

export default App;