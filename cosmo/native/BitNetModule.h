/**
 * BitNetModule.h
 * ==============
 * iOS/macOS Objective-C header for the BitNet React Native module.
 *
 * Exposes the synchronous install() method that binds global.cosmoBitNet
 * into the JSI runtime, enabling sub-1ms synchronous inference calls from JS.
 */

#import <React/RCTBridgeModule.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface BitNetModule : NSObject <RCTBridgeModule>

/**
 * Installs global.cosmoBitNet into the JSI runtime.
 * Must be called from JavaScript before any inference operations.
 * Returns YES on success, NO on failure (logged to os_log).
 */
- (NSNumber*)install;

/**
 * Returns YES if the module has already been installed.
 */
- (NSNumber*)isInstalled;

/**
 * Returns YES on physical Apple Silicon / A-series devices where
 * NEON SIMD instructions are available for fast ternary inference.
 * Returns NO on Simulator.
 */
- (NSNumber*)isHardwareSupported;

@end

NS_ASSUME_NONNULL_END
