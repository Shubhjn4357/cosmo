/**
 * BitNetModule.mm
 * ===============
 * iOS Objective-C++ module that installs the BitNet JSI bridge into the
 * React Native JSI runtime.
 *
 * Registered via RCT_EXPORT_MODULE so that NativeModules.BitNetModule is
 * available in JavaScript. The critical call is the blocking synchronous
 * `install` method which resolves the runtime and binds global.cosmoBitNet.
 *
 * Build requirements:
 *   Xcode: Add BitNetJSI.cpp and BitNetModule.mm to the app target.
 *   Link:  The llama.cpp library provided by llama.rn is linked automatically
 *          via `pod 'llama.rn'` — no additional linkage step required.
 */

#import "BitNetModule.h"

#import <React/RCTBridge+Private.h>
#import <React/RCTUtils.h>
#import <ReactCommon/RCTTurboModule.h>
#import <jsi/jsi.h>

// C++ header — compiled as Objective-C++ via .mm extension.
#include "BitNetJSI.h"

#import <Foundation/Foundation.h>
#import <os/log.h>

static os_log_t kBitNetLog = nil;

@implementation BitNetModule {
    BOOL _isInstalled;
}

// MARK: - RCTBridgeModule

RCT_EXPORT_MODULE(BitNetModule)

+ (void)load {
    // Initialise the system log category once.
    kBitNetLog = os_log_create("com.cosmoai.bitnet", "JSIBridge");
}

+ (BOOL)requiresMainQueueSetup {
    return NO;  // Module initialisation is thread-safe.
}

- (instancetype)init {
    if ((self = [super init])) {
        _isInstalled = NO;
    }
    return self;
}

// MARK: - install

/**
 * Called from JavaScript:
 *   NativeModules.BitNetModule.install()
 *
 * RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD returns synchronously so that
 * global.cosmoBitNet is bound before the JS code continues.
 */
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) {
    if (_isInstalled) {
        os_log_info(kBitNetLog, "install: already installed — skipping");
        return @YES;
    }

    // ── Resolve JSI runtime ───────────────────────────────────────────────────
    RCTBridge*    bridge    = [RCTBridge currentBridge];
    RCTCxxBridge* cxxBridge = (RCTCxxBridge*)bridge;

    if (!cxxBridge || cxxBridge.runtime == nil) {
        os_log_error(kBitNetLog, "install: cxxBridge.runtime is nil — JSI not available");
        return @NO;
    }

    facebook::jsi::Runtime& jsiRuntime =
        *reinterpret_cast<facebook::jsi::Runtime*>(cxxBridge.runtime);

    std::shared_ptr<facebook::react::CallInvoker> callInvoker =
        bridge.jsCallInvoker;

    // ── Create and bind BitNetJSI ─────────────────────────────────────────────
    try {
        auto bitNetJSI = std::make_shared<facebook::jsi::BitNetJSI>(
            jsiRuntime,
            callInvoker
        );

        facebook::jsi::Object hostObj =
            facebook::jsi::Object::createFromHostObject(jsiRuntime, std::move(bitNetJSI));

        // Bind to global.cosmoBitNet — accessible from all JS contexts.
        jsiRuntime.global().setProperty(
            jsiRuntime,
            "cosmoBitNet",
            std::move(hostObj)
        );

        _isInstalled = YES;
        os_log_info(kBitNetLog, "install: global.cosmoBitNet bound successfully");
        return @YES;

    } catch (const facebook::jsi::JSError& e) {
        os_log_error(kBitNetLog, "install: JSI error — %{public}s", e.message().c_str());
        return @NO;

    } catch (const std::exception& e) {
        os_log_error(kBitNetLog, "install: C++ exception — %{public}s", e.what());
        return @NO;

    } catch (...) {
        os_log_error(kBitNetLog, "install: unknown C++ exception");
        return @NO;
    }
}

// MARK: - isInstalled

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(isInstalled) {
    return @(_isInstalled);
}

// MARK: - isHardwareSupported

/**
 * Returns YES on all real Apple Silicon and A-series devices.
 * This is a synchronous check — no need for async on iOS.
 */
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(isHardwareSupported) {
#if TARGET_OS_SIMULATOR
    return @NO;  // Simulator: ARM NEON not guaranteed.
#else
    return @YES; // All physical iOS/iPadOS/macOS Apple Silicon devices.
#endif
}

@end
