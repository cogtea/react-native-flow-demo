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

import GooglePayView, { SessionData, ApiCallResult } from './GooglePayView';
import ApplePayView from './ApplePayView';

const { FlowModule, CheckoutFlowManager, ApplePayModule } = NativeModules as any;

let paymentSessionID = '';
let paymentSessionToken = '';
let paymentSessionSecret = '';
let publicKey = 'pk_sbox_cw74tz3jqjqisdg2qb3vpzeaxes'; // Replace with your real public key
const merchantIdentifier = 'merchant.com.flow.checkout.sandbox'; // Replace with your merchant ID

function App(): React.JSX.Element {
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [showingFlow, setShowingFlow] = useState(false);

  const handleSubmit = async (sessionData: SessionData): Promise<ApiCallResult> => {
    setStatus('Submitting payment...');
    try {
      // Ensure we have the raw session data
      if (!sessionData.sessionData) {
        throw new Error('No session data available for submission');
      }

      // Make the API call to checkout.com to submit the modified payment session
      // Using the raw session data from the SDK (not id/secret)
      const response = await fetch(`https://api.sandbox.checkout.com/payment-sessions/${sessionData.id}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer sk_sbox_eabgr5n7s3pno2f6xtscee6gwq=',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_data: sessionData.sessionData,
          "3ds": {
            enabled: true
          }
        }),
      });

      const responseData = await response.json();
      
      if (response.ok) {
        if (responseData.status === 'Action Required' && responseData.action?.type === '3ds') {
          setStatus('3DS Authentication required...');
        } else {
          setStatus(`Success: ${responseData.id || 'Payment completed'}`);
        }
        // Hide the flow after handling submit (success path)
        setError(null);
        setShowingFlow(false);

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
        setError(`Payment failed: ${responseData.message || 'Unknown error'}`);
        // Hide the flow on error as well
        setShowingFlow(false);
        return {
          success: false,
          error: responseData.message || 'Payment submission failed',
        };
      }
    } catch (error) {
      setStatus('Error');
      setError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      // Ensure the flow is hidden if an exception occurs
      setShowingFlow(false);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

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

      paymentSessionID = id;
      paymentSessionToken = payment_session_token;
      paymentSessionSecret = payment_session_secret;

      setStatus('Payment flow started');
      setShowingFlow(true);


    } catch (error) {
      setError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setStatus('Error');
      setShowingFlow(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>

      {showingFlow ? (
        Platform.OS === 'ios' ? (
          <ApplePayView
            style={{ width: '100%', height: 60, position: 'absolute', bottom: 0 }}
            paymentSessionID={paymentSessionID}
            paymentSessionToken={paymentSessionToken}
            paymentSessionSecret={paymentSessionSecret}
            publicKey={publicKey}
            merchantIdentifier={merchantIdentifier}
            environment="sandbox"
            handleSubmit={handleSubmit}
          />
        ) : (
          <GooglePayView
            style={{ width: '100%', height: 60, position: 'absolute', bottom: 0 }}
            paymentSessionID={paymentSessionID}
            paymentSessionToken={paymentSessionToken}
            paymentSessionSecret={paymentSessionSecret}
            publicKey={publicKey}
            environment="sandbox"
            handleSubmit={handleSubmit}
          />
        )
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