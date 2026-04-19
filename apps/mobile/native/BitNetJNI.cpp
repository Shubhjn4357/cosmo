/**
 * BitNetJNI.cpp
 * =============
 * Android JNI entry point for the Cosmo AI BitNet JSI Bridge.
 *
 * This file is compiled into libbitnet_jsi.so by the Android Gradle build.
 * It is invoked from BitNetModule.java via System.loadLibrary("bitnet_jsi")
 * and the nativeInstall() call.
 *
 * The JNI function resolves the JS runtime pointer and the call-invoker
 * from the React Native bridge, initialises BitNetJSI, and binds it to
 * global.cosmoBitNet in the JSI runtime so that JS can call it synchronously
 * without any async bridge overhead.
 */

#include <jni.h>
#include <android/log.h>
#include <stdexcept>
#include <string>

#include <jsi/jsi.h>
#include <ReactCommon/CallInvokerHolder.h>

#include "BitNetJSI.h"

#define BITNET_LOG_TAG "CosmoAI:BitNet"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  BITNET_LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, BITNET_LOG_TAG, __VA_ARGS__)

using namespace facebook;

extern "C" {

/**
 * Java signature:
 *   com.cosmoai.bitnet.BitNetModule.nativeInstall(long runtimePtr, CallInvokerHolderImpl holder)
 *
 * Called once from the module's install() method, which is itself invoked
 * from JavaScript via NativeModules.BitNetModule.install().
 */
JNIEXPORT void JNICALL
Java_com_cosmoai_bitnet_BitNetModule_nativeInstall(
    JNIEnv*  env,
    jobject  /* thiz */,
    jlong    runtimePtr,
    jobject  jsCallInvokerHolder)
{
    LOGI("nativeInstall: runtime=0x%llx", (unsigned long long)runtimePtr);

    if (runtimePtr == 0) {
        LOGE("nativeInstall: runtimePtr is null — aborting");
        jclass exc = env->FindClass("java/lang/IllegalStateException");
        env->ThrowNew(exc, "BitNet JSI install failed: runtimePtr is null");
        return;
    }

    if (jsCallInvokerHolder == nullptr) {
        LOGE("nativeInstall: jsCallInvokerHolder is null — aborting");
        jclass exc = env->FindClass("java/lang/IllegalStateException");
        env->ThrowNew(exc, "BitNet JSI install failed: CallInvokerHolder is null");
        return;
    }

    jsi::Runtime* runtime =
        reinterpret_cast<jsi::Runtime*>(static_cast<uintptr_t>(runtimePtr));

    std::shared_ptr<react::CallInvoker> jsCallInvoker =
        react::CallInvokerHolder::getCallInvoker(env, jsCallInvokerHolder);

    try {
        auto bitNetJSI = std::make_shared<jsi::BitNetJSI>(*runtime, jsCallInvoker);

        jsi::Object hostObj =
            jsi::Object::createFromHostObject(*runtime, std::move(bitNetJSI));

        // Expose as global.cosmoBitNet — visible to all JS contexts.
        runtime->global().setProperty(*runtime, "cosmoBitNet", std::move(hostObj));

        LOGI("nativeInstall: global.cosmoBitNet bound successfully");

    } catch (const jsi::JSError& e) {
        LOGE("nativeInstall: JSI error — %s", e.message().c_str());
        jclass exc = env->FindClass("java/lang/RuntimeException");
        env->ThrowNew(exc, e.message().c_str());

    } catch (const std::exception& e) {
        LOGE("nativeInstall: C++ exception — %s", e.what());
        jclass exc = env->FindClass("java/lang/RuntimeException");
        env->ThrowNew(exc, e.what());

    } catch (...) {
        LOGE("nativeInstall: unknown exception");
        jclass exc = env->FindClass("java/lang/RuntimeException");
        env->ThrowNew(exc, "BitNet JSI install failed with unknown exception");
    }
}

/**
 * JNI_OnLoad — called when System.loadLibrary("bitnet_jsi") completes.
 * Used to cache the JVM reference for any future callbacks.
 */
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /* reserved */) {
    LOGI("JNI_OnLoad: libbitnet_jsi loaded");
    (void)vm;
    return JNI_VERSION_1_6;
}

} // extern "C"
