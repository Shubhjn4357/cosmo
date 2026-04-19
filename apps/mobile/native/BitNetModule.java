package com.cosmoai.bitnet;

import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.turbomodule.core.CallInvokerHolderImpl;

/**
 * BitNetModule.java
 * =================
 * Android React Native module that installs the BitNet JSI bridge.
 *
 * This module loads the native shared library (libbitnet_jsi.so) which
 * contains the llama.cpp-backed inference engine and the JSI HostObject.
 *
 * The critical path:
 *   1. JS calls NativeModules.BitNetModule.install()    [synchronous]
 *   2. Java resolves the JSI runtime pointer + CallInvokerHolder
 *   3. JNI nativeInstall() creates BitNetJSI and binds global.cosmoBitNet
 *
 * After this, JS code can call global.cosmoBitNet.loadModel() and
 * global.cosmoBitNet.generate() directly via JSI with zero bridge overhead.
 */
@ReactModule(name = BitNetModule.NAME)
public class BitNetModule extends ReactContextBaseJavaModule {

    public static final String NAME = "BitNetModule";
    private static final String TAG  = "CosmoAI:BitNet";

    /** Guards against double-install within the same RN session. */
    private volatile boolean isInstalled = false;

    // ── Native library ────────────────────────────────────────────────────────

    static {
        try {
            System.loadLibrary("bitnet_jsi");
            Log.i(TAG, "libbitnet_jsi.so loaded successfully");
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Failed to load libbitnet_jsi.so: " + e.getMessage());
        }
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    public BitNetModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * install() — synchronous JSI bridge initialisation.
     *
     * Resolves the JS runtime pointer from the catalyst instance and hands it
     * to JNI where BitNetJSI (HostObject) is constructed and bound to
     * global.cosmoBitNet.
     *
     * isBlockingSynchronousMethod = true is REQUIRED: global.cosmoBitNet must
     * be available before the Promise returned by the JS NativeModules call
     * resolves.
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    public void install() {
        if (isInstalled) {
            Log.i(TAG, "install: already installed — skipping");
            return;
        }

        ReactApplicationContext context = getReactApplicationContext();

        if (context == null) {
            Log.e(TAG, "install: ReactApplicationContext is null");
            return;
        }

        if (!context.hasCatalystInstance()) {
            Log.e(TAG, "install: CatalystInstance is not ready");
            return;
        }

        try {
            long runtimePtr = context.getJavaScriptContextHolder().get();
            if (runtimePtr == 0) {
                Log.e(TAG, "install: JavaScript context pointer is 0 — bridge not initialised");
                return;
            }

            CallInvokerHolderImpl jsCallInvokerHolder =
                (CallInvokerHolderImpl) context.getCatalystInstance().getJSCallInvokerHolder();

            if (jsCallInvokerHolder == null) {
                Log.e(TAG, "install: JSCallInvokerHolder is null");
                return;
            }

            nativeInstall(runtimePtr, jsCallInvokerHolder);

            isInstalled = true;
            Log.i(TAG, "install: global.cosmoBitNet bound successfully");

        } catch (Exception e) {
            Log.e(TAG, "install: exception — " + e.getMessage(), e);
        }
    }

    /**
     * Returns true if the JSI bridge has been installed in this RN session.
     * Exposed to JS for diagnostic purposes.
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    public boolean isInstalled() {
        return isInstalled;
    }

    /**
     * Returns true on all physical Android ARM devices.
     * JSI ternary kernels benefit from ARMv8 NEON SIMD.
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    public boolean isHardwareSupported() {
        String abi = System.getProperty("os.arch", "");
        // arm64-v8a, armeabi-v7a → NEON available
        return abi.startsWith("arm") || abi.startsWith("aarch64");
    }

    // ── Native (JNI) ──────────────────────────────────────────────────────────

    /**
     * Implemented in BitNetJNI.cpp.
     * Creates the BitNetJSI HostObject and binds it to global.cosmoBitNet.
     *
     * @param runtimePtr           Pointer to the facebook::jsi::Runtime instance.
     * @param jsCallInvokerHolder  Holder for the JS thread's CallInvoker.
     */
    private native void nativeInstall(
        long runtimePtr,
        @NonNull CallInvokerHolderImpl jsCallInvokerHolder
    );
}
