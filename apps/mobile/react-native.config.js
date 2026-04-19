/**
 * React Native configuration file
 * Fixes autolinking issues with native modules
 */

module.exports = {
  project: {
    ios: {
      sourceDir: './ios',
    },
    android: {
      sourceDir: './android',
      packageName: 'com.nova.ai',
    },
  },
  // Exclude problematic packages from autolinking if needed
  dependencies: {
    // react-native-executorch has autolinking issues on EAS
    // Uncomment to disable autolinking for it:
    // 'react-native-executorch': {
    //   platforms: {
    //     android: null,
    //   },
    // },
  },
};
