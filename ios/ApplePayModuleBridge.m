#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(ApplePayModule, RCTEventEmitter)

RCT_EXTERN_METHOD(handleSubmitResponse:(NSString *)requestId
                  success:(BOOL)success
                  data:(NSDictionary *)data)

RCT_EXTERN_METHOD(submit:(NSString *)paymentSessionID
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
