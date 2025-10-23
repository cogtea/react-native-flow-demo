import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  Button,
  StyleSheet,
  Platform,
  Text,
  View,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';

import GooglePayView from './GooglePayView';

const { FlowModule, CheckoutFlowManager } = NativeModules;

let paymentSessionID = '';
let paymentSessionToken = '';
let paymentSessionSecret = '';
let publicKey = 'pk_sbox_cw74tz3jqjqisdg2qb3vpzeaxes'; // Replace with your real public key

function App(): React.JSX.Element {
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [showingFlow, setShowingFlow] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios' && !CheckoutFlowManager) {
      console.error('CheckoutFlowManager is not linked properly for iOS.');
    }
    if (Platform.OS === 'android' && !FlowModule) {
      console.error('FlowModule is not linked properly for Android.');
    }

    const nativeModule = Platform.OS === 'android' ? FlowModule : CheckoutFlowManager;
    const flowEvents = new NativeEventEmitter(nativeModule);

    console.log('Attaching event listeners for Flow...');

    const successSub = flowEvents.addListener('onFlowPaymentSuccess', async (data) => {
      console.log('✅ Payment Success Event:', data);
      setStatus(`Success: ${data.paymentId}`);
      setError(null);
      setShowingFlow(false);
    });

    const errorSub = flowEvents.addListener('onFlowPaymentError', async (errorData) => {
      console.error('❌ Payment Error Event:', errorData);
      setStatus('Error');
      setError(`Error from ${errorData.component}: ${errorData.errorMessage}`);
      setShowingFlow(false);
    });

    return () => {
      successSub.remove();
      errorSub.remove();
    };
  }, []);

  useEffect(() => {
    console.log("🔁 showingFlow changed:", showingFlow);
  }, [showingFlow]);

  const startPayment = async () => {
    setStatus('Processing...');
    setError(null);

    try {
      const response = await fetch('https://api.sandbox.checkout.com/payment-sessions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer sk_sbox_eabgr5n7s3pno2f6xtscee6gwq=',
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

      console.log('✅ Payment session created:', id);
      paymentSessionID = id;
      paymentSessionToken = payment_session_token;
      paymentSessionSecret = payment_session_secret;


      // if (Platform.OS === 'ios') {
      //   const initResult = await CheckoutFlowManager.initialize({
      //     id,
      //     payment_session_secret,
      //   });
      //   console.log('iOS initialization result:', initResult);
      //   const renderResult = await CheckoutFlowManager.renderFlow();
      //   console.log('iOS render result:', renderResult);
      // } else if (Platform.OS === 'android') {
      //   FlowModule.startPaymentSession(id, payment_session_token, payment_session_secret);
      // }

      setStatus('Payment flow started');
      setShowingFlow(true);

      // Fallback: dismiss flow overlay after 15s in case native event doesn't fire
      setTimeout(() => {
        if (showingFlow) {
          console.warn('⚠️ Fallback timeout reached — dismissing manually');
          setShowingFlow(false);
        }
      }, 15000);

    } catch (error) {
      console.error('❌ Error:', error);
      setError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setStatus('Error');
      setShowingFlow(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>

      {showingFlow ? (
        <GooglePayView
          style={{ width: '100%', height: 60, position: 'absolute', bottom: 0 }}
          paymentSessionID={paymentSessionID}
          paymentSessionToken={paymentSessionToken}
          paymentSessionSecret={paymentSessionSecret}
          publicKey={publicKey}
        />
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
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#c00' },
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