const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Custom Expo config plugin to inject hardware acceleration native libraries
 * required by llama.rn for GPU/NPU offloading.
 */
const withLlamaAcceleration = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    // Ensure the uses-native-library tag structure exists
    if (!mainApplication['uses-native-library']) {
      mainApplication['uses-native-library'] = [];
    }

    const nativeLibs = [
      'libcdsprpc.so', // Snapdragon Hexagon (NPU)
      'libOpenCL.so',  // GPU Acceleration
    ];

    nativeLibs.forEach((libName) => {
      // Check if it already exists
      const exists = mainApplication['uses-native-library'].some(
        (item) => item.$['android:name'] === libName
      );

      if (!exists) {
        mainApplication['uses-native-library'].push({
          $: {
            'android:name': libName,
            'android:required': 'false',
          },
        });
      }
    });

    return config;
  });
};

module.exports = withLlamaAcceleration;
