import React, { useCallback, useEffect, useState } from 'react';
import {
  SafeAreaView,
  Button,
  ScrollView,
  useWindowDimensions,
  StyleSheet,
  Platform,
  Text,
  View,
  Modal,
  Pressable,
  UIManager,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';

import CardView from './CardView';

interface SessionData {
  id: string;
  secret: string;
  sessionData?: string;
}

interface ApiCallResult {
  success: boolean;
  data?: any;
  error?: string;
}

interface TokenizedCallbackResult {
  accepted: boolean;
  rejectionMessage?: string;
}

const { FlowModule, CheckoutFlowManager, ApplePayModule } = NativeModules as any;

const publicKey = 'pk_sbox_u57rqbpjsrmyjpyrycxk42jbnuz';

function App(): React.JSX.Element {
  useWindowDimensions();
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [showingFlow, setShowingFlow] = useState(false);
  const [isSubmittingFromJs, setIsSubmittingFromJs] = useState(false);
  const [saveCardAsDefault, setSaveCardAsDefault] = useState(false);
  const flowScrollRef = React.useRef<ScrollView | null>(null);
  const [paymentSession, setPaymentSession] = useState({
    id: '',
    token: '',
    secret: '',
  });

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    if (!showingFlow) return;
    requestAnimationFrame(() => {
      flowScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
    const t = setTimeout(() => {
      flowScrollRef.current?.scrollTo({ y: 0, animated: false });
    }, 120);
    return () => clearTimeout(t);
  }, [showingFlow]);

  const isSessionReady =
    paymentSession.id.trim().length > 0 &&
    paymentSession.secret.trim().length > 0;

  const handleCardNativeHeight = useCallback((_event: { height: number }) => {
    // Height updates from native measurement are disabled on both platforms.
  }, []);

  const handleTokenized = useCallback(async (tokenizationResult: any): Promise<TokenizedCallbackResult> => {
    const schemeLocal = tokenizationResult.schemeLocal?.toLowerCase();
    const localSchemes = tokenizationResult.cardMetadata?.localSchemes?.map((s: string) => s.toLowerCase()) ?? [];
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
      if (!sessionData.sessionData) {
        throw new Error('No session data available for submission');
      }

      const submitUrl = `https://api.sandbox.checkout.com/payment-sessions/${sessionData.id}/submit`;
      const submitPayload = {
        session_data: sessionData.sessionData,
        '3ds': {
          enabled: true,
        },
      };

      const response = await fetch(submitUrl, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk_sbox_dlqbu36qaj2ee76vso5vddm4vac',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitPayload),
      });

      const responseText = await response.text();
      let responseData: any = null;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

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
            response: JSON.stringify(responseData),
            paymentId: responseData.id,
            status: responseData.status,
            action: responseData.action,
          },
        };
      }

      setStatus('Error');
      const errorMsg = `Payment failed: ${responseData.message || JSON.stringify(responseData) || 'Unknown error'}`;
      setError(errorMsg);
      setShowingFlow(true);
      return {
        success: false,
        error: responseData.message || 'Payment submission failed',
      };
    } catch (submitError) {
      const errorMsg = submitError instanceof Error ? submitError.message : String(submitError);
      setStatus('Error');
      setError(`Error: ${errorMsg}`);
      setShowingFlow(true);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }, []);

  useEffect(() => {
    const subs: Array<{ remove: () => void } | undefined> = [];

    try {
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
            setShowingFlow(true);
          })
        );
      }

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
            setShowingFlow(true);
          })
        );
      }

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
            setShowingFlow(true);
          })
        );
      }
    } catch (_e) {
      // Ignore in non-native environments.
    }

    return () => {
      subs.forEach(s => s?.remove?.());
    };
  }, []);

  const startPayment = async () => {
    setStatus('Processing...');
    setError(null);

    try {
      const requestPayload = {
        amount: 1000,
        currency: 'AED',
        reference: 'ORD-123A',
        processing_channel_id: 'pc_6biffo54jgnufis4jenkhioawa',
        billing: {
          address: {
            country: 'AE',
          },
        },
        '3ds': {
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
      };

      const response = await fetch('https://api.sandbox.checkout.com/payment-sessions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk_sbox_dlqbu36qaj2ee76vso5vddm4vac',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const { id, payment_session_token, payment_session_secret } = data;

      setPaymentSession({
        id,
        token: payment_session_token,
        secret: payment_session_secret,
      });
      // setCardHeight(500);
      // setRawCardNativeHeight(500);

      setStatus('Payment flow started');
      setShowingFlow(true);
    } catch (startError) {
      const errorMsg = startError instanceof Error ? startError.message : String(startError);
      setError(`Error: ${errorMsg}`);
      setStatus('Error');
      setShowingFlow(false);
    }
  };

  const submitCardFromJs = async () => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      setError('Custom JS submit is wired only for Android/iOS in this sample.');
      return;
    }
    if (!paymentSession.id) {
      setError('No payment session available. Start payment first.');
      return;
    }

    try {
      setIsSubmittingFromJs(true);
      setStatus('Submitting from JS button...');
      const moduleForSubmit = Platform.OS === 'ios' ? NativeModules.ApplePayModule : NativeModules.CardModule;
      if (!moduleForSubmit || typeof moduleForSubmit.submit !== 'function') {
        const moduleName = Platform.OS === 'ios' ? 'ApplePayModule' : 'CardModule';
        throw new Error(`${moduleName}.submit is not available in NativeModules`);
      }
      await moduleForSubmit.submit(paymentSession.id);
      setError(null);
    } catch (submitError) {
      const errorMsg = submitError instanceof Error ? submitError.message : String(submitError);
      setStatus('Error');
      setError(`JS submit failed: ${errorMsg}`);
    } finally {
      setIsSubmittingFromJs(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Checkout.com Cards Demo</Text>

      <View style={styles.statusContainer}>
        <Text>Status: </Text>
        <Text
          style={
            status.startsWith('Success')
              ? styles.successText
              : status === 'Error'
                ? styles.errorText
                : status === 'Processing...'
                  ? styles.processingText
                  : styles.readyText
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
        <Text>Current Platform: {Platform.OS}</Text>
      </View>

      <Button title="Start Card Payment" onPress={startPayment} disabled={status === 'Processing...'} />

      <Modal
        visible={showingFlow}
        transparent
        animationType="slide"
        onRequestClose={() => setShowingFlow(false)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowingFlow(false)} />

          <View style={styles.sheetContainer}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sectionTitle}>Card Payment</Text>
              <Button title="Close" onPress={() => setShowingFlow(false)} />
            </View>

            <ScrollView
              key={`flow-scroll-${showingFlow ? (paymentSession.id || 'open') : 'closed'}`}
              ref={flowScrollRef}
              style={styles.flowContainer}
              contentContainerStyle={styles.flowContentContainer}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustContentInsets={false}
              contentInsetAdjustmentBehavior="never"
            >
              <View style={styles.paymentMethodContainer}>
                {isSessionReady ? (
                  <View
                    style={[
                      styles.cardContainer,
                      Platform.OS === 'ios' && styles.cardContainerIOS,
                    ]}
                  >

                    <CardView
                      style={styles.cardView}
                      paymentSessionID={paymentSession.id}
                      paymentSessionToken={paymentSession.token}
                      paymentSessionSecret={paymentSession.secret}
                      publicKey={publicKey}
                      environment="sandbox"
                      showPayButton={false}
                      hasHandleSubmitListener={true}
                      handleSubmit={handleSubmit}
                      onTokenized={handleTokenized}
                      onCardNativeHeight={handleCardNativeHeight}
                    />
                  </View>
                ) : (
                  <View style={styles.loadingContainer}>
                    <Text>Preparing card form...</Text>
                  </View>
                )}
                <Pressable
                  style={styles.checkboxRow}
                  onPress={() => setSaveCardAsDefault(prev => !prev)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: saveCardAsDefault }}
                >
                  <View style={[styles.checkbox, saveCardAsDefault && styles.checkboxChecked]}>
                    {saveCardAsDefault && <Text style={styles.checkboxMark}>✓</Text>}
                  </View>
                  <Text style={styles.checkboxLabel}>Save card as default</Text>
                </Pressable>
                <Pressable
                  style={[styles.payButton, (!isSessionReady || isSubmittingFromJs) && styles.payButtonDisabled]}
                  onPress={submitCardFromJs}
                  disabled={!isSessionReady || isSubmittingFromJs}
                >
                  <Text style={styles.payButtonText}>
                    {isSubmittingFromJs ? 'Submitting...' : 'Pay'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>

          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-start', alignItems: 'center', padding: 20, paddingTop: 32 },
  flowContainer: { flex: 1, width: '100%' },
  flowContentContainer: { alignItems: 'stretch', justifyContent: 'flex-start', paddingBottom: 16 },
  paymentMethodContainer: { padding: 20, paddingBottom: 8, gap: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600' },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.12)',
  },
  sheetContainer: {
    height: '82%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  sheetContainerExpandedIOS: {
    height: '92%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  cardView: {
    width: '100%',
    minHeight: 300,
  },
  cardContainer: {
    width: '100%',
    overflow: 'visible',
  },
  cardContainerIOS: {
    // no extra top margin needed
    height: 300,
  },
  loadingContainer: {
    height: 400,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9f9f9',
  },
  payButton: {
    backgroundColor: '#cc0000',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  payButtonDisabled: {
    opacity: 0.5,
  },
  payButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxChecked: {
    backgroundColor: '#cc0000',
    borderColor: '#cc0000',
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  checkboxLabel: {
    marginLeft: 10,
    fontSize: 15,
    color: '#222',
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
});

export default App;
