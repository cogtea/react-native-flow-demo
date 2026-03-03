#import <Foundation/Foundation.h>
#import <React/RCTViewManager.h>

@interface RCT_EXTERN_REMAP_MODULE(RNApplePayView, ApplePayViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(paymentSessionID, NSString)
RCT_EXPORT_VIEW_PROPERTY(paymentSessionSecret, NSString)
RCT_EXPORT_VIEW_PROPERTY(publicKey, NSString)
RCT_EXPORT_VIEW_PROPERTY(merchantIdentifier, NSString)
RCT_EXPORT_VIEW_PROPERTY(environment, NSString)
RCT_EXPORT_VIEW_PROPERTY(paymentMethod, NSString)
RCT_EXPORT_VIEW_PROPERTY(showPayButton, BOOL)
RCT_EXPORT_VIEW_PROPERTY(hasHandleSubmitListener, BOOL)

@end

@interface RCT_EXTERN_REMAP_MODULE(RNCardView, CardViewIOSManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(paymentSessionID, NSString)
RCT_EXPORT_VIEW_PROPERTY(paymentSessionSecret, NSString)
RCT_EXPORT_VIEW_PROPERTY(publicKey, NSString)
RCT_EXPORT_VIEW_PROPERTY(merchantIdentifier, NSString)
RCT_EXPORT_VIEW_PROPERTY(environment, NSString)
RCT_EXPORT_VIEW_PROPERTY(paymentMethod, NSString)
RCT_EXPORT_VIEW_PROPERTY(hasHandleSubmitListener, BOOL)

@end
